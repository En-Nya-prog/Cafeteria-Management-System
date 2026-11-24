import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { databaseConnectionOptions } from "../lib/databaseConnection.js";
import { matchingMfaCounter, sealMfa, staffMfaKey, unsealMfa } from "../lib/staffMfa.js";

test("remote PostgreSQL settings always verify the server certificate", () => {
  const options = databaseConnectionOptions("postgresql://user:pass@db.example/test?sslmode=no-verify", { ca: "test\\nca" });
  assert.equal(new URL(options.connectionString).searchParams.has("sslmode"), false);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: "test\nca" });
  assert.equal(databaseConnectionOptions("postgresql://localhost/test").ssl, undefined);
});

test("authenticator codes match RFC 6238 and encrypted secrets are bound to their owner", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(matchingMfaCounter(secret, "287082", 59000), 1);
  assert.equal(matchingMfaCounter(secret, "000000", 59000), null);
  const key = staffMfaKey("ab".repeat(32));
  const encrypted = sealMfa(secret, key, "staff:a");
  assert.equal(unsealMfa(encrypted, key, "staff:a"), secret);
  assert.equal(unsealMfa(encrypted, key, "staff:b"), null);
});

test("Buyer and Seller permissions, staff MFA, and database audit events", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Use a local PostgreSQL server.");
  const admin = new pg.Client({ connectionString: url.href });
  const schema = "cafeteria_security_" + randomBytes(8).toString("hex");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cafeteria-security-"));
  const csv = path.join(directory, "menu.csv");
  await admin.connect();
  let db, app, server;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set("options", "-c search_path=" + schema);
    Object.assign(process.env, {
      DATABASE_URL: url.href, NODE_ENV: "development", DISABLE_HMR: "true",
      PRODUCTS_CSV_PATH: csv, REQUIRE_VERIFIED_BUYERS: "true",
      GOOGLE_CLIENT_ID: "mock-client", GOOGLE_CLIENT_SECRET: "mock-secret",
      STAFF_MFA_KEY: randomBytes(32).toString("hex"),
      RESEND_API_KEY: "", RESEND_FROM_EMAIL: "", HUBTEL_CLIENT_ID: "", HUBTEL_CLIENT_SECRET: "",
    });
    const { createApp } = await import("../serverRuntime.js");
    app = await createApp();
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const origin = "http://127.0.0.1:" + server.address().port;
    db = new pg.Client({ connectionString: url.href });
    await db.connect();
    await db.query(`
      UPDATE users SET google_subject = 'buyer-test-subject' WHERE id = 'user-customer';
      INSERT INTO users(id,name,email,role,google_subject) VALUES ('buyer-other','Other buyer','other-buyer@example.invalid','Buyer','other-subject');
      INSERT INTO users(id,name,email,role) VALUES ('seller-other','Other seller','other-seller@example.invalid','Seller');
      INSERT INTO meals(id,name,category,price,stock,seller_id,available_start,available_end)
        VALUES ('owned-meal','Owned meal','Lunch Meals',10,5,'user-seller','00:00','23:59');
      INSERT INTO sales(id,meal_id,quantity,user_id,order_status)
        VALUES ('buyer-order','owned-meal',1,'user-customer','new'), ('other-order','owned-meal',1,'buyer-other','new');
    `);
    async function session(id, mfaVerified = false) {
      const token = randomBytes(32).toString("hex");
      await db.query("INSERT INTO sessions(token_hash,user_id,expires_at,mfa_verified) VALUES($1,$2,$3,$4)", [
        createHash("sha256").update(token).digest("hex"), id, new Date(Date.now() + 3600000).toISOString(), mfaVerified,
      ]);
      return "ebd_session=" + token;
    }
    const request = (route, cookie, method = "GET", body) => fetch(`${origin}/api/${route}`, {
      method, redirect: "manual",
      headers: { origin, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body && JSON.stringify(body),
    });
    const buyer = await session("user-customer");
    const seller = await session("user-seller", true);
    const unauthorizedSeller = await session("seller-other", true);
    const staffWithoutMfa = await session("user-seller");
    const adminCookie = await session("user-admin", true);
    assert.equal((await request("inventory", staffWithoutMfa)).status, 401);
    assert.equal((await request("sellers", buyer)).status, 403);
    assert.equal((await request("sellers", seller)).status, 403);
    assert.equal((await request("sellers", adminCookie)).status, 200);
    assert.equal((await request("audit-log", buyer)).status, 403);
    assert.equal((await request("audit-log", seller)).status, 403);
    assert.equal((await request("audit-log?before=9999999999999999999", adminCookie)).status, 400);
    assert.equal((await request("auth/google/link", buyer, "POST", {})).status, 404);
    const orders = await (await request("my-orders", buyer)).json();
    assert.deepEqual(orders.map(order => order.id), ["buyer-order"]);
    assert.equal((await request("sales/buyer-order/status", unauthorizedSeller, "PATCH", { status: "accepted" })).status, 403);
    const meal = { id: "owned-meal", name: "Owned meal", category: "Lunch Meals", price: 12, stock: 5, available_start: "00:00", available_end: "23:59" };
    assert.equal((await request("meals", unauthorizedSeller, "POST", meal)).status, 403);
    assert.equal((await request("meals", seller, "POST", meal)).status, 200);
    const audit = await db.query("SELECT actor_id, details FROM security_audit WHERE resource_id='owned-meal' AND action='UPDATE'");
    assert.deepEqual(audit.rows, [{ actor_id: "user-seller", details: { previous_price: 10, current_price: 12 } }]);
    const history = await request("audit-log", adminCookie);
    assert.equal(history.status, 200);
    assert.equal(history.headers.get("cache-control"), "no-store");
    assert.ok((await history.json()).events.some(event =>
      event.actor_id === "user-seller" && event.resource_id === "owned-meal" && event.details.current_price === 12));
    assert.equal((await request("register", null, "POST", {})).status, 403);
    const login = { email: "seller@ebd.com", password: "seller123" };
    const response = await request("login", null, "POST", login);
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("set-cookie"), null);
    const { setupKey, enrollment } = await response.json();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const keyBits = Array.from(setupKey, letter => alphabet.indexOf(letter).toString(2).padStart(5, "0")).join("");
    const authenticatorKey = Buffer.from(keyBits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const hash = createHmac("sha1", authenticatorKey).update(counter).digest();
    const mfaCode = String((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
    const verified = await request("login", null, "POST", { ...login, mfaCode, enrollment });
    assert.equal(verified.status, 200);
    assert.ok(verified.headers.get("set-cookie"));
    assert.equal((await request("login", null, "POST", { ...login, mfaCode, enrollment })).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await app?.locals.closeVite?.();
    await app?.locals.closeDatabase?.();
    await db?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await fs.unlink(csv).catch(error => { if (error.code !== "ENOENT") throw error; });
    await fs.rmdir(directory);
  }
});
