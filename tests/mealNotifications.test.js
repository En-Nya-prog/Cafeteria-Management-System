import test from "node:test";
import assert from "node:assert/strict";
import { sendMealEmail, sendMealSms } from "../lib/mealNotifications.js";

test("sends a new meal announcement through Resend with escaped HTML", async () => {
  let request;
  await sendMealEmail({
    buyerEmail: "buyer@example.com",
    meal: { name: "<Rice & stew>", category: "Lunch", price: 12.5 },
    appUrl: "https://cafeteria.example",
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "E3 <menu@example.com>" },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.to, ["buyer@example.com"]);
  assert.match(payload.html, /&lt;Rice &amp; stew&gt;/);
  assert.equal(payload.text.includes("<Rice & stew>"), true);
});

test("refuses to call Resend when delivery credentials are missing", async () => {
  let called = false;
  await assert.rejects(
    sendMealEmail({
      buyerEmail: "buyer@example.com",
      meal: { name: "Rice", category: "Lunch", price: 12 },
      appUrl: "https://cafeteria.example",
      env: {},
      fetchImpl: async () => { called = true; },
    }),
    /RESEND_API_KEY and RESEND_FROM_EMAIL/
  );
  assert.equal(called, false);
});

test("sends a new meal announcement to Hubtel using E.164 phone numbers", async () => {
  let request;
  await sendMealSms({
    phone: "+233241234567",
    meal: { name: "Jollof", price: 20 },
    appUrl: "https://cafeteria.example",
    env: {
      HUBTEL_CLIENT_ID: "client",
      HUBTEL_CLIENT_SECRET: "secret",
      HUBTEL_SENDER_ID: "E3Cafeteria",
    },
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return { ok: true, status: 200 };
    },
  });

  assert.equal(request.url.searchParams.get("From"), "E3Cafeteria");
  assert.equal(request.url.searchParams.get("To"), "233241234567");
  assert.match(request.url.searchParams.get("Content"), /Jollof, GHS 20\.00/);
  assert.equal(
    request.options.headers.Authorization,
    `Basic ${Buffer.from("client:secret").toString("base64")}`
  );
});
