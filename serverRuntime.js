import "dotenv/config";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.migrate" });
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { promisify } from "node:util";
import { argon2id, hash as hashArgon2, verify as verifyArgon2 } from "argon2";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { createObjectCsvWriter } from "csv-writer";
import { put } from "@vercel/blob";
import pg from "pg";
import { applyDatabaseSchema } from "./lib/databaseSchema.js";
import { databaseConnectionOptions } from "./lib/databaseConnection.js";
import { createMfaSecret, matchingMfaCounter, sealMfa, staffMfaKey, unsealMfa } from "./lib/staffMfa.js";
import { getTrustedOrigins } from "./lib/requestOrigins.js";
import { DAILY_MEAL_DAYS, ghanaDate, ghanaTime, isMealScheduled, isTime, nextMealDate, normalizeMealDays } from "./lib/mealAvailability.js";
import {
  buildPaymentLines,
  isVerifiedPaystackPayment,
  verifyPaystackSignature,
} from "./lib/payments.js";

import {
  sendMealEmail,
  sendMealSms,
  sendSellerOrderEmail,
  sendSellerOrderSms,
} from "./lib/mealNotifications.js";

const uploadsDir = path.resolve(process.env.UPLOADS_DIR || "uploads");
const isVercel = Boolean(process.env.VERCEL);
const isVercelPreview = isVercel && process.env.VERCEL_ENV === "preview";
if (!isVercel && !fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const csvPath = path.resolve(process.env.PRODUCTS_CSV_PATH || "products.csv");
let activePool;
let sessionCleanup;
let rateLimitCleanup;

export async function createApp(expressFramework = express, httpServer) {
  const app = expressFramework();
  const production = process.env.NODE_ENV === "production";
  const mfaKey = production || process.env.STAFF_MFA_KEY ? staffMfaKey(process.env.STAFF_MFA_KEY) : null;
  const verifiedBuyersOnly = process.env.REQUIRE_VERIFIED_BUYERS !== undefined
    ? process.env.REQUIRE_VERIFIED_BUYERS === "true" : production;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must point to a PostgreSQL database.");
  }
  const pool = activePool = new pg.Pool({
    ...databaseConnectionOptions(process.env.DATABASE_URL, { requireTls: process.env.NODE_ENV === "production" }),
    max: isVercel ? 1 : 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error:", error));
  app.locals.closeDatabase = () => pool.end();
  const transactionContext = new AsyncLocalStorage();
  const requestContext = new AsyncLocalStorage();
  app.use((req, res, next) => requestContext.run({}, next));
  const toPostgresParameters = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  const query = (sql, params = []) => {
    const transaction = transactionContext.getStore();
    if (!transaction && requestContext.getStore()?.actorId &&
        /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:meals|payments|users|staff_mfa)\b/i.test(sql)) {
      return db.transaction(() => query(sql, params))();
    }
    const executor = transaction || pool;
    return executor.query(toPostgresParameters(sql), params);
  };
  const db = {
    exec: (sql) => query(sql),
    prepare: (sql) => ({
      get: async (...params) => (await query(sql, params)).rows[0],
      all: async (...params) => (await query(sql, params)).rows,
      run: async (...params) => ({ changes: (await query(sql, params)).rowCount }),
    }),
    transaction: (callback) => async (...args) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const actorId = requestContext.getStore()?.actorId;
        if (actorId) await client.query("SELECT set_config('cafeteria.actor_id', $1, true)", [actorId]);
        const result = await transactionContext.run(client, () => callback(...args));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("PostgreSQL transaction rollback failed:", rollbackError);
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
  const ADMIN_ROLE = "Admin";
  const SELLER_ROLE = "Seller";
  const CUSTOMER_ROLE = "Buyer";
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
  const PAYMENT_RESERVATION_MS = 30 * 60 * 1000;
  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  const isTestPaystackMode = isVercel && (
    isVercelPreview || process.env.PAYSTACK_MODE === "test"
  );
  const APP_BASE_URL = process.env.APP_BASE_URL ||
    (isVercel && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (verifiedBuyersOnly && (!googleClientId || !googleClientSecret)) {
    throw new Error("Configure Google OAuth to require verified Buyer accounts.");
  }
  const googleCallbackPath = "/api/auth/google/callback";
  const googleRedirectUri = googleClientId && googleClientSecret
    ? new URL(googleCallbackPath, APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).href
    : null;

  if (process.env.NODE_ENV === "production") {
    const requiredPaystackPrefix = isTestPaystackMode ? "sk_test_" : "sk_live_";
    if (typeof PAYSTACK_SECRET_KEY !== "string" || !PAYSTACK_SECRET_KEY.startsWith(requiredPaystackPrefix)) {
      throw new Error(`A ${isTestPaystackMode ? "test" : "live"} PAYSTACK_SECRET_KEY is required in this production environment.`);
    }
    let appUrl;
    try {
      appUrl = new URL(APP_BASE_URL);
    } catch {
      throw new Error("APP_BASE_URL must be set to the HTTPS public URL of this app.");
    }
    if (appUrl.protocol !== "https:" || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
      throw new Error("APP_BASE_URL must be an HTTPS origin without a path, query, or fragment.");
    }
  }

  const hashPassword = (password) => hashArgon2(password, {
    type: argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });

  const scrypt = promisify(crypto.scrypt);
  const verifyPassword = async (password, storedPassword) => {
    if (typeof storedPassword !== "string") return false;
    if (storedPassword.startsWith("$argon2id$")) {
      return verifyArgon2(storedPassword, password);
    }
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(storedPassword)) return false;

    const [salt, hash] = storedPassword.split(":");
    const derived = await scrypt(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived);
  };

  app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
  app.use((req, res, next) => {
    const development = process.env.NODE_ENV !== "production";
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self'${development ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self' https://checkout.paystack.com",
        ...(development ? [] : ["upgrade-insecure-requests"]),
      ].join("; ")
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (!development) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

    const csvWriter = isVercel ? null : createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: "id", title: "id" },
      { id: "item_code", title: "item_code" },
      { id: "name", title: "name" },
      { id: "category", title: "category" },
      { id: "description", title: "description" },
      { id: "price", title: "price" },
      { id: "stock", title: "stock" },
      { id: "image_url", title: "image_url" },
      { id: "available_start", title: "available_start" },
      { id: "available_end", title: "available_end" },
      { id: "available_days", title: "available_days" },
    ],
  });

  const syncToCsv = async () => {
    if (isVercel) return;
    const meals = await db.prepare("SELECT * FROM meals").all();
    await csvWriter.writeRecords(meals);
  };

  if (process.env.NODE_ENV !== "production") {
    await db.transaction(() => applyDatabaseSchema(db))();
  } else {
    const databaseRole = await db.prepare(`
      SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls
        OR has_schema_privilege(current_user, current_schema(), 'CREATE')
        OR EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname IN ('meals', 'users', 'security_audit')
            AND pg_has_role(current_user, c.relowner, 'MEMBER')
        ) AS elevated
      FROM pg_roles r WHERE r.rolname = current_user
    `).get();
    if (databaseRole?.elevated) {
      throw new Error("Production DATABASE_URL must use a restricted role. Run npm run migrate:schema with the schema-owner URL.");
    }
  }

  const userCount = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (Number(userCount.count) === 0 && process.env.NODE_ENV !== "production") {
    const userStmt = db.prepare("INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)");
    await userStmt.run("user-admin", "Administrator", "admin@ebd.com", ADMIN_ROLE, await hashPassword("admin123"));
    await userStmt.run("user-seller", "Seller", "seller@ebd.com", SELLER_ROLE, await hashPassword("seller123"));
    await userStmt.run("user-customer", "Customer", "student@ebd.com", CUSTOMER_ROLE, await hashPassword("student123"));
  } else if (process.env.NODE_ENV === "production") {
    const adminEmail = process.env.EBD_ADMIN_EMAIL?.trim().toLowerCase();
    const adminPassword = process.env.EBD_ADMIN_PASSWORD;
    const hasBootstrapConfig = Boolean(adminEmail || adminPassword);
    if (hasBootstrapConfig && (
      !adminEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) ||
      adminEmail.length > 254 ||
      typeof adminPassword !== "string" ||
      adminPassword.length < 10 ||
      adminPassword.length > 128
    )) {
      throw new Error("EBD_ADMIN_EMAIL must be valid and EBD_ADMIN_PASSWORD must contain 10 to 128 characters.");
    }

    if (Number(userCount.count) === 0 && hasBootstrapConfig) {
      await db.prepare("INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)").run(
        crypto.randomUUID(),
        "Administrator",
        adminEmail,
        ADMIN_ROLE,
        await hashPassword(adminPassword)
      );
    } else if (Number(userCount.count) === 0) {
      throw new Error("Set EBD_ADMIN_EMAIL and EBD_ADMIN_PASSWORD to bootstrap a production administrator.");
    }

    const legacyAdmin = await db.prepare("SELECT id, email, password FROM users WHERE id = ? OR email = ?")
      .get("user-admin", "admin@ebd.com");
    if (legacyAdmin && await verifyPassword("admin123", legacyAdmin.password)) {
      if (!hasBootstrapConfig) {
        throw new Error("The default administrator password is still active. Set EBD_ADMIN_EMAIL and EBD_ADMIN_PASSWORD to rotate it.");
      }
      const emailOwner = await db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(adminEmail, legacyAdmin.id);
      if (emailOwner) throw new Error("EBD_ADMIN_EMAIL is already assigned to another account.");
      await db.prepare("UPDATE users SET email = ?, password = ?, role = ? WHERE id = ?").run(
        adminEmail,
        await hashPassword(adminPassword),
        ADMIN_ROLE,
        legacyAdmin.id
      );
    }

    for (const [id, email, password] of [
      ["user-seller", "seller@ebd.com", "seller123"],
      ["user-customer", "student@ebd.com", "student123"],
    ]) {
      const legacyUser = await db.prepare("SELECT id, password FROM users WHERE id = ? OR email = ?").get(id, email);
      if (legacyUser && await verifyPassword(password, legacyUser.password)) {
        await db.prepare("DELETE FROM users WHERE id = ?").run(legacyUser.id);
      }
    }
  }

  const demoMeals = {
    "Breakfast Meals": [
      ["Hausa Koko", "Spiced millet porridge.", "hausa-koko.jpg"],
      ["Waakye", "Rice and beans served with Ghanaian pepper sauce.", "waakye.jpg"],
    ],
    "Lunch Meals": [
      ["Ghanaian Jollof Rice", "Rice cooked in a seasoned tomato base.", "jollof.jpg"],
      ["Banku and Tilapia", "Fermented corn and cassava dough served with tilapia.", "banku-tilapia.jpg"],
    ],
    Snacks: [
      ["Kelewele", "Spiced fried ripe plantain.", "kelewele.jpg"],
      ["Bofrot", "Golden Ghanaian fried dough.", "bofrot.jpg"],
    ],
    Beverages: [
      ["Sobolo", "Chilled hibiscus drink.", "sobolo.png"],
      ["Mashed Kenkey", "A chilled maize drink with honey and ginger.", "mashed-kenkey.jpg"],
    ],
    Desserts: [
      ["Nkatie Cake", "Sweet, crunchy groundnut brittle.", "nkatie-cake.jpg"],
      ["Fresh Mango", "Ripe seasonal mango.", "mango.jpg"],
    ],
  };
  const mealCount = await db.prepare("SELECT COUNT(*) as count FROM meals").get();
  if (Number(mealCount.count) === 0 && process.env.NODE_ENV !== "production") {
    const stmt = db.prepare("INSERT INTO meals (id, name, category, description, price, stock, image_url, available_start, available_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

    let i = 0;
    for (const [cat, dishes] of Object.entries(demoMeals)) {
      let start = "06:00";
      let end = "20:00";

      if (cat === "Breakfast Meals") {
        start = "06:00";
        end = "10:30";
      } else if (cat === "Lunch Meals") {
        start = "11:30";
        end = "15:00";
      } else if (cat === "Snacks" || cat === "Beverages") {
        start = "15:00";
        end = "20:00";
      }

      for (const [name, description, image] of dishes) {
        await stmt.run(
          `meal-${++i}`,
          name,
          cat,
          description,
          (Math.random() * 30 + 5).toFixed(2),
          Math.floor(Math.random() * 100),
          `/assets/demo-meals/${image}`,
          start,
          end
        );
      }
    }
  } else if (Number(mealCount.count) === 0) {
    console.warn("The production menu is empty. Add meals using the admin account after deployment.");
  }
  if (process.env.NODE_ENV !== "production" && Number(mealCount.count) > 0) {
    const findDemoMeals = db.prepare(`
      SELECT id FROM meals
      WHERE category = ? AND seller_id IS NULL AND id ~ '^meal-[0-9]+$'
        AND name = category || ' Option ' || substr(id, 6)
        AND description = 'Freshly prepared ' || lower(category) || ' special'
        AND (image_url = ? OR image_url = 'https://picsum.photos/seed/meal' || substr(id, 6) || '/400/300')
      ORDER BY length(id), id
      FOR UPDATE
    `);
    const updateDemoMeal = db.prepare("UPDATE meals SET name = ?, description = ?, image_url = ? WHERE id = ?");
    await db.transaction(async () => {
      for (const [category, dishes] of Object.entries(demoMeals)) {
        const meals = await findDemoMeals.all(category, `/demo-meals/${dishes[0][2]}`);
        for (const [index, meal] of meals.entries()) {
          const [name, description, image] = dishes[index % dishes.length];
          await updateDemoMeal.run(name, description, `/assets/demo-meals/${image}`, meal.id);
        }
      }
    })();
    await db.prepare(`
      UPDATE meals SET image_url = '/assets' || image_url
      WHERE seller_id IS NULL AND id ~ '^meal-[0-9]+$' AND image_url LIKE '/demo-meals/%'
    `).run();
  }

  app.use((req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.path === "/api/webhooks/paystack") {
      return next();
    }

    const origin = req.get("origin");
    if (!origin) {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ message: "Origin header required." });
      }
      return next();
    }

    let requestOrigin;
    try {
      requestOrigin = new URL(origin).origin;
    } catch {
      return res.status(403).json({ message: "Invalid request origin." });
    }

    const allowedOrigins = getTrustedOrigins({
      appBaseUrl: APP_BASE_URL,
      requestOrigin: `${req.protocol}://${req.get("host")}`,
      vercelUrl: isVercel ? process.env.VERCEL_URL : undefined,
      vercelProjectProductionUrl: isVercel
        ? process.env.VERCEL_PROJECT_PRODUCTION_URL
        : undefined,
    });
    if (!allowedOrigins.has(requestOrigin)) {
      return res.status(403).json({ message: "Cross-origin request rejected." });
    }
    next();
  });

  app.post(
    "/api/webhooks/paystack",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      if (!verifyPaystackSignature(req.body, req.get("x-paystack-signature"), PAYSTACK_SECRET_KEY || "")) {
        return res.status(401).json({ message: "Invalid webhook signature." });
      }

      try {
        const event = JSON.parse(req.body.toString("utf8"));
        if (event.event === "charge.success" && typeof event.data?.reference === "string") {
          await verifyAndFulfillPayment(event.data.reference);
        }
        res.sendStatus(200);
      } catch (error) {
        console.error("Paystack webhook processing failed:", error);
        res.status(500).json({ message: "Webhook processing failed." });
      }
    }
  );

  app.use(express.json({ limit: "1mb" }));
  app.use("/uploads", express.static(uploadsDir));
  if (!isVercel) {
    app.use("/assets/demo-meals", express.static(fileURLToPath(new URL("./assets/demo-meals/", import.meta.url))));
  }

  const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
  const clearExpiredRateLimits = async () => {
    await db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(Date.now());
  };
  let lastRateLimitCleanup = 0;
  const createRateLimit = ({ limit, windowMs, message }) => asyncHandler(async (req, res, next) => {
    const now = Date.now();
    if (now - lastRateLimitCleanup >= 15 * 60 * 1000) {
      await clearExpiredRateLimits();
      lastRateLimitCleanup = now;
    }

    const rateLimitKey = crypto.createHash("sha256")
      .update(`${req.baseUrl}${req.route?.path || req.path}:${req.user?.id || req.ip}`)
      .digest("hex");
    const entry = await db.prepare(`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (?, 1, ?)
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.reset_at <= ? THEN 1
          ELSE LEAST(rate_limits.count + 1, ?)
        END,
        reset_at = CASE
          WHEN rate_limits.reset_at <= ? THEN ?
          ELSE rate_limits.reset_at
        END
      RETURNING count, reset_at
    `).get(rateLimitKey, now + windowMs, now, limit + 1, now, now + windowMs);

    if (entry.count > limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((Number(entry.reset_at) - now) / 1000))));
      return res.status(429).json({ message });
    }
    next();
  });

  const loginRateLimit = createRateLimit({
    limit: 10,
    windowMs: 15 * 60 * 1000,
    message: "Too many sign-in attempts. Try again in 15 minutes.",
  });
  const registrationRateLimit = createRateLimit({
    limit: 5,
    windowMs: 60 * 60 * 1000,
    message: "Too many account creation attempts. Try again later.",
  });
  const paymentInitializationRateLimit = createRateLimit({
    limit: 5,
    windowMs: 15 * 60 * 1000,
    message: "Too many checkout attempts. Try again in 15 minutes.",
  });
  const paymentVerificationRateLimit = createRateLimit({
    limit: 10,
    windowMs: 15 * 60 * 1000,
    message: "Too many payment status checks. Try again in 15 minutes.",
  });

  const clearExpiredSessions = async () => {
    await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  };
  clearExpiredSessions().catch((error) => console.error("Session cleanup failed:", error));
  if (!isVercel) {
    sessionCleanup = setInterval(() => {
      clearExpiredSessions().catch((error) => console.error("Session cleanup failed:", error));
    }, 60 * 60 * 1000);
    sessionCleanup.unref();

    rateLimitCleanup = setInterval(() => {
      clearExpiredRateLimits().catch((error) => console.error("Rate limit cleanup failed:", error));
    }, 15 * 60 * 1000);
    rateLimitCleanup.unref();
  }

  app.get("/api/healthz", asyncHandler(async (req, res) => {
    try {
      await db.prepare("SELECT 1").get();
      res.json({ status: "ok" });
    } catch (error) {
      console.error("Health check failed:", error);
      res.status(503).json({ status: "unavailable" });
    }
  }));

  const loadSession = async (req) => {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)ebd_session=([a-f0-9]{64})(?:;|$)/);
    if (!match) return null;

    const tokenHash = crypto.createHash("sha256").update(match[1]).digest("hex");
    const session = await db.prepare(`
      SELECT users.id, users.name, users.email, users.role, users.google_subject,
        sessions.expires_at, sessions.mfa_verified
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
    `).get(tokenHash);

    if (!session || Date.parse(session.expires_at) <= Date.now()) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }
    if ((mfaKey && [ADMIN_ROLE, SELLER_ROLE].includes(session.role) && !session.mfa_verified) ||
        (verifiedBuyersOnly && session.role === CUSTOMER_ROLE && !session.google_subject)) return null;

    req.user = {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role,
    };
    const auditContext = requestContext.getStore();
    if (auditContext) auditContext.actorId = session.id;
    return req.user;
  };

  const authenticate = (req, res, next) => {
    loadSession(req).then((user) => {
      if (!user) return res.status(401).json({ message: "Authentication required" });
      next();
    }).catch(next);
  };

  const requireRoles = (allowedRoles) => {
    return (req, res, next) => {
      loadSession(req).then((user) => {
        if (!user) return res.status(401).json({ message: "Authentication required" });
        if (!allowedRoles.includes(user.role)) return res.status(403).json({ message: "Forbidden" });
        next();
      }).catch(next);
    };
  };

  const createSession = async (user, res, mfaVerified = false) => {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, mfa_verified) VALUES (?, ?, ?, ?)").run(
      tokenHash,
      user.id,
      expiresAt,
      mfaVerified
    );
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.append(
      "Set-Cookie",
      `ebd_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DURATION_MS / 1000}${secure}`
    );
  };

  const clearSession = async (req, res) => {
    const cookie = req.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)ebd_session=([a-f0-9]{64})(?:;|$)/);
    if (match) {
      const tokenHash = crypto.createHash("sha256").update(match[1]).digest("hex");
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    }
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `ebd_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
  };

  const clientError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  const isPositiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

  const paystackRequest = async (endpoint, options = {}) => {
    if (!PAYSTACK_SECRET_KEY) {
      const error = new Error("Online payments are not configured.");
      error.statusCode = 503;
      throw error;
    }

    let response;
    try {
      response = await fetch(`https://api.paystack.co${endpoint}`, {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (error) {
      console.error("Paystack request failed:", error);
      const requestError = new Error("Payment provider is temporarily unavailable.");
      requestError.statusCode = 502;
      throw requestError;
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.status || !result?.data) {
      console.error("Paystack returned an unsuccessful response:", response.status, result?.message || "invalid response");
      const requestError = new Error("Payment provider could not process the request.");
      requestError.statusCode = 502;
      throw requestError;
    }
    return result.data;
  };

  const fulfillVerifiedPayment = db.transaction(async (reference) => {
    const payment = await db.prepare("SELECT * FROM payments WHERE reference = ? FOR UPDATE").get(reference);
    if (!payment) throw new Error("Payment reference not found.");
    if (payment.status === "paid") return "paid";
    if (payment.status === "needs_review") return "needs_review";
    if (payment.status !== "pending" || Date.parse(payment.reserved_until) <= Date.now()) {
      await db.prepare("UPDATE payments SET status = 'needs_review', verified_at = ? WHERE reference = ?")
        .run(new Date().toISOString(), reference);
      return "needs_review";
    }

    const items = await db.prepare("SELECT * FROM payment_items WHERE reference = ?").all(reference);
    const user = await db.prepare("SELECT name FROM users WHERE id = ?").get(payment.user_id);
    if (!user) throw new Error("Payment account no longer exists.");
    const requiredByMeal = new Map();
    for (const item of items) {
      requiredByMeal.set(item.meal_id, (requiredByMeal.get(item.meal_id) || 0) + item.quantity);
    }

    const now = new Date().toISOString();
    const meals = new Map();
    for (const mealId of [...requiredByMeal.keys()].sort()) {
      const meal = await db.prepare("SELECT stock FROM meals WHERE id = ? FOR UPDATE").get(mealId);
      if (meal) meals.set(mealId, meal);
    }
    for (const [mealId, requiredQuantity] of requiredByMeal) {
      const meal = meals.get(mealId);
      const reservedElsewhere = Number((await db.prepare(`
        SELECT COALESCE(SUM(payment_items.quantity), 0) AS quantity
        FROM payment_items
        JOIN payments ON payments.reference = payment_items.reference
        WHERE payment_items.meal_id = ?
          AND payments.reference != ?
          AND payments.status = 'pending'
          AND payments.reserved_until > ?
      `).get(mealId, reference, now)).quantity);
      if (!meal || meal.stock < reservedElsewhere + requiredQuantity) {
        await db.prepare("UPDATE payments SET status = 'needs_review', verified_at = ? WHERE reference = ?")
          .run(now, reference);
        return "needs_review";
      }
    }

    const saleStatement = db.prepare(`
      INSERT INTO sales (id, meal_id, quantity, total_price, customer_name, timestamp, user_id, reference, pickup_time, pickup_date, order_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
    `);
    const preorderStatement = db.prepare(`
      INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, pickup_date, status, timestamp, user_id)
      VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
    `);
    for (const item of items) {
      const saleId = crypto.randomUUID();
      const meal = await db.prepare("SELECT seller_id, name FROM meals WHERE id = ?").get(item.meal_id);
      await saleStatement.run(
        saleId,
        item.meal_id,
        item.quantity,
        (item.unit_amount * item.quantity) / 100,
        user.name,
        now,
        payment.user_id,
        reference,
        item.pickup_time,
        item.pickup_date
      );
      await db.prepare(`
        INSERT INTO order_assignments (id, sale_id, seller_id, status, assigned_at, updated_at)
        VALUES (?, ?, ?, 'new', ?, ?)
        ON CONFLICT (sale_id) DO NOTHING
      `).run(crypto.randomUUID(), saleId, meal?.seller_id || null, now, now);
      if (meal?.seller_id) {
        await db.prepare(`
          INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at)
          VALUES (?, ?, 'order', 'New buyer order', ?, ?, ?, ?, NULL)
        `).run(crypto.randomUUID(), meal.seller_id, `${meal.name} was ordered (${item.quantity}).`, item.meal_id, saleId, now);
      } else {
        const sellerAccounts = await db.prepare("SELECT id FROM users WHERE role = ?").all(SELLER_ROLE);
        for (const seller of sellerAccounts) {
          await db.prepare(`
            INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at)
            VALUES (?, ?, 'order', 'New shared-menu order', ?, ?, ?, ?, NULL)
          `).run(crypto.randomUUID(), seller.id, `${meal?.name || "A shared menu meal"} was ordered (${item.quantity}); accept it to take responsibility.`, item.meal_id, saleId, now);
        }
      }
      if (item.pickup_time) {
        const preorderId = crypto.randomUUID();
        await preorderStatement.run(
          preorderId,
          user.name,
          item.meal_id,
          item.quantity,
          item.pickup_time,
          item.pickup_date,
          now,
          payment.user_id
        );
        await db.prepare("UPDATE preorders SET seller_id = ?, payment_status = 'paid' WHERE id = ?")
          .run(meal?.seller_id || null, preorderId);
        const recipients = meal?.seller_id
          ? [{ id: meal.seller_id }]
          : await db.prepare("SELECT id FROM users WHERE role = ?").all(SELLER_ROLE);
        for (const recipient of recipients) {
          await db.prepare("INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at) VALUES (?, ?, 'preorder', 'New pre-order', ?, ?, ?, ?, NULL)")
            .run(crypto.randomUUID(), recipient.id, `${meal?.name || "Shared menu meal"} (x${item.quantity}) requested for pickup: ${[item.pickup_date, item.pickup_time].filter(Boolean).join(" ")}.`, item.meal_id, preorderId, now);
        }
      }
    }
    for (const [mealId, quantity] of requiredByMeal) {
      await db.prepare("UPDATE meals SET stock = stock - ? WHERE id = ?").run(quantity, mealId);
    }
    await db.prepare("UPDATE payments SET status = 'paid', verified_at = ? WHERE reference = ?")
      .run(now, reference);
    return "paid";
  });


const notifySellersOfPaidOrder = async (reference) => {
  try {
    const payment = await db.prepare(
      "SELECT user_id FROM payments WHERE reference = ? AND status = 'paid'"
    ).get(reference);

    if (!payment) return;

    const buyer = await db.prepare(
      "SELECT name FROM users WHERE id = ?"
    ).get(payment.user_id);

    if (!buyer) return;

    // Retrieve only meals assigned to actual seller accounts.
    const orderItems = await db.prepare(`
      SELECT
        u.id AS seller_id,
        u.name AS seller_name,
        u.email AS seller_email,
        u.phone AS seller_phone,
        m.name AS meal_name,
        pi.quantity,
        pi.unit_amount
      FROM payment_items pi
      JOIN meals m ON m.id = pi.meal_id
      JOIN users u ON u.id = m.seller_id
      WHERE pi.reference = ?
        AND u.role = ?
      ORDER BY u.id, m.name
    `).all(reference, SELLER_ROLE);

    const sellers = new Map();

    for (const item of orderItems) {
      if (!sellers.has(item.seller_id)) {
        sellers.set(item.seller_id, {
          id: item.seller_id,
          name: item.seller_name,
          email: item.seller_email,
          phone: item.seller_phone,
          items: [],
          totalAmount: 0,
        });
      }

      const seller = sellers.get(item.seller_id);
      const unitPrice = Number(item.unit_amount) / 100;

      seller.items.push({
        name: item.meal_name,
        quantity: Number(item.quantity),
        unitPrice,
      });

      seller.totalAmount += unitPrice * Number(item.quantity);
    }

    const appUrl = APP_BASE_URL || "http://localhost:3000";
    const buyerName = buyer.name || "Customer";

    const deliver = async (seller, channel, send) => {
      const now = new Date();
      const timestamp = now.toISOString();
      const staleBefore = new Date(
        now.getTime() - 10 * 60 * 1000
      ).toISOString();

      // Claim this notification. A sent notification cannot be claimed again.
      const claim = await db.prepare(`
        INSERT INTO seller_order_notification_deliveries
          (reference, seller_id, channel, status, updated_at)
        VALUES (?, ?, ?, 'sending', ?)
        ON CONFLICT (reference, seller_id, channel)
        DO UPDATE SET
          status = 'sending',
          updated_at = EXCLUDED.updated_at
        WHERE
          seller_order_notification_deliveries.status = 'failed'
          OR (
            seller_order_notification_deliveries.status = 'sending'
            AND seller_order_notification_deliveries.updated_at < ?
          )
        RETURNING channel
      `).get(
        reference,
        seller.id,
        channel,
        timestamp,
        staleBefore
      );

      if (!claim) return;

      try {
        await send();

        await db.prepare(`
          UPDATE seller_order_notification_deliveries
          SET status = 'sent', updated_at = ?
          WHERE reference = ? AND seller_id = ? AND channel = ?
        `).run(
          new Date().toISOString(),
          reference,
          seller.id,
          channel
        );
      } catch (error) {
        await db.prepare(`
          UPDATE seller_order_notification_deliveries
          SET status = 'failed', updated_at = ?
          WHERE reference = ? AND seller_id = ? AND channel = ?
        `).run(
          new Date().toISOString(),
          reference,
          seller.id,
          channel
        );

        console.error(
          `Seller ${channel} notification failed for ${seller.id}:`,
          error
        );
      }
    };

    for (const seller of sellers.values()) {
      const tasks = [];

      if (seller.email) {
        tasks.push(
          deliver(seller, "email", () =>
            sendSellerOrderEmail({
              sellerEmail: seller.email,
              sellerName: seller.name,
              buyerName,
              orderReference: reference,
              items: seller.items,
              totalAmount: seller.totalAmount,
              appUrl,
            })
          )
        );
      }

      if (seller.phone) {
        tasks.push(
          deliver(seller, "sms", () =>
            sendSellerOrderSms({
              phone: seller.phone,
              sellerName: seller.name,
              buyerName,
              orderReference: reference,
              items: seller.items,
              totalAmount: seller.totalAmount,
            })
          )
        );
      }

      await Promise.allSettled(tasks);
    }
  } catch (error) {
    console.error("Seller order notifications could not be processed:", error);
  }
};



const verifyAndFulfillPayment = async (reference) => {
  if (typeof reference !== "string" || !/^ebd_[a-f0-9-]{36}$/.test(reference)) {
    throw new Error("Invalid payment reference.");
  }

  const payment = await db.prepare(
    "SELECT * FROM payments WHERE reference = ?"
  ).get(reference);

  if (!payment) throw new Error("Payment reference not found.");

  // Payment may already have been fulfilled by the webhook.
  // Check notification delivery so failed notifications can be retried.
  if (payment.status === "paid") {
    await notifySellersOfPaidOrder(reference);
    return "paid";
  }

  if (payment.status === "needs_review") return "needs_review";

  const transaction = await paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {},
    }
  );

  if (transaction.status !== "success") {
    if (
      transaction.status === "failed" ||
      transaction.status === "abandoned"
    ) {
      await db.prepare(`
        UPDATE payments
        SET status = 'failed'
        WHERE reference = ? AND status = 'pending'
      `).run(reference);

      return "failed";
    }

    return Date.parse(payment.reserved_until) <= Date.now()
      ? "expired"
      : "pending";
  }

  const user = await db.prepare(
    "SELECT email FROM users WHERE id = ?"
  ).get(payment.user_id);

  if (
    !user ||
    !isVerifiedPaystackPayment(transaction, payment, user.email)
  ) {
    throw new Error(
      "Payment provider verification did not match this order."
    );
  }

  // Complete the payment transaction first.
  const status = await fulfillVerifiedPayment(reference);

  // Notify sellers only after successful payment fulfillment.
  if (status === "paid") {
    await notifySellersOfPaidOrder(reference);
  }


  return status;
};


  const isAdmin = requireRoles([ADMIN_ROLE]);
  app.get("/api/audit-log", isAdmin, asyncHandler(async (req, res) => {
    const { before } = req.query;
    if (before !== undefined && (typeof before !== "string" || !/^[1-9]\d{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)) {
      return res.status(400).json({ message: "Invalid audit log cursor." });
    }
    const events = await db.prepare(`
      SELECT * FROM cafeteria_audit_log
      WHERE (?::bigint IS NULL OR id < ?::bigint)
      ORDER BY id DESC LIMIT 51
    `).all(before ?? null, before ?? null);
    res.set("Cache-Control", "no-store");
    res.json({ events: events.slice(0, 50), next: events.length > 50 ? events[49].id : null });
  }));
  const isStaff = requireRoles([ADMIN_ROLE, SELLER_ROLE]);
  const isBuyer = requireRoles([CUSTOMER_ROLE]);

  const notifyBuyersOfMealChange = async (meal, appUrl, action) => {
    const buyers = await db.prepare(`
      SELECT id, email, phone, meal_email_opt_in, meal_sms_opt_in
      FROM users
      WHERE role = ?
    `).all(CUSTOMER_ROLE);
    const timestamp = new Date().toISOString();
    const title = action === "updated" ? "Meal updated" : "New meal available";
    const message = action === "updated"
      ? `${meal.name} has been updated and is available for GHS ${Number(meal.price).toFixed(2)}.`
      : `${meal.name} is now available for GHS ${Number(meal.price).toFixed(2)}.`;

    for (let offset = 0; offset < buyers.length; offset += 500) {
      const batch = buyers.slice(offset, offset + 500);
      const placeholders = batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params = batch.flatMap((buyer) => [
        crypto.randomUUID(),
        buyer.id,
        "meal",
        title,
        message,
        meal.id,
        timestamp,
        null,
      ]);
      await db.prepare(`
        INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, timestamp, read_at)
        VALUES ${placeholders}
      `).run(...params);
    }

    const deliverToOptedInBuyers = async (channel, optedInBuyers, send) => {
      const results = await Promise.allSettled(optedInBuyers.map((buyer) => send(buyer)));
      let failed = 0;
      results.forEach((result, index) => {
        if (result.status !== "rejected") return;
        failed += 1;
        console.error(`New meal ${channel} notification failed for buyer ${optedInBuyers[index].id}:`, result.reason);
      });
      return { sent: results.length - failed, failed };
    };

    const emailBuyers = buyers.filter((buyer) => buyer.meal_email_opt_in);
    const smsBuyers = buyers.filter((buyer) => buyer.meal_sms_opt_in && buyer.phone);
    const [email, sms] = await Promise.all([
      deliverToOptedInBuyers("email", emailBuyers, (buyer) =>
        sendMealEmail({ buyerEmail: buyer.email, meal, appUrl, action })
      ),
      deliverToOptedInBuyers("SMS", smsBuyers, (buyer) =>
        sendMealSms({ phone: buyer.phone, meal, appUrl, action })
      ),
    ]);

    return { inApp: buyers.length, email, sms };
  };

  const storage = isVercel
    ? multer.memoryStorage()
    : multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.mimetype];
      cb(null, uniqueSuffix + extension);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
        return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image"));
      }
      cb(null, true);
    },
  });
  const saveUploadedImage = async (file) => {
    if (!isVercel) return `/uploads/${file.filename}`;
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw Object.assign(new Error("Image storage is not configured. Connect a Vercel Blob store."), { statusCode: 503 });
    }

    const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.mimetype];
    const blob = await put(`meals/${crypto.randomUUID()}${extension}`, file.buffer, {
      access: "public",
      addRandomSuffix: true,
    });
    return blob.url;
  };

  app.get("/api/meals", asyncHandler(async (req, res) => {
    const meals = await db.prepare("SELECT * FROM meals").all();
    res.json(meals);
  }));

  app.get("/api/inventory", isStaff, asyncHandler(async (req, res) => {
    const inventory = await db.prepare("SELECT * FROM meals ORDER BY name").all();
    res.json(inventory);
  }));

  app.get("/api/inventory/low-stock", isStaff, asyncHandler(async (req, res) => {
    const meals = await db.prepare("SELECT * FROM meals").all();
    const lowStock = meals.filter((meal) => {
      const stock = Number(meal.stock ?? 0);
      const threshold = Number(meal.minimum_threshold ?? meal.lowStockThreshold ?? 10);
      return stock <= threshold;
    });

    res.json(lowStock);
  }));

  app.post("/api/upload", isStaff, upload.single("image"), asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const imageUrl = await saveUploadedImage(req.file);
    res.json({ url: imageUrl, imageUrl });
  }));

  app.post("/api/meals", isStaff, upload.single("image"), asyncHandler(async (req, res) => {
    const {
      id,
      name,
      category,
      description,
      price,
      stock,
      image_url,
      imageUrl,
      available_start,
      available_end,
      available_days,
      availability_status,
    } = req.body;

    const resolvedImageUrl = image_url || imageUrl || null;

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    const normalizedAvailability = availability_status || "available";
    const normalizedDays = normalizeMealDays(available_days);
    if (available_days !== undefined && !normalizedDays) {
      return res.status(400).json({ message: "Choose at least one available day." });
    }
    if (
      typeof id !== "string" || !id.trim() ||
      typeof name !== "string" || !name.trim() || name.length > 120 ||
      typeof category !== "string" || !category.trim() || category.length > 80 ||
      !Number.isFinite(parsedPrice) || parsedPrice < 0 ||
      !Number.isSafeInteger(parsedStock) || parsedStock < 0 ||
      !["available", "unavailable", "sold_out"].includes(normalizedAvailability) ||
      !isTime(available_start) || !isTime(available_end) ||
      (description != null && (typeof description !== "string" || description.length > 2000)) ||
      (resolvedImageUrl != null && (typeof resolvedImageUrl !== "string" || resolvedImageUrl.length > 2048))
    ) {
      return res.status(400).json({ message: "Invalid meal details." });
    }

    const existingMeal = await db.prepare("SELECT seller_id FROM meals WHERE id = ?").get(id.trim());
    if (
      req.user.role === SELLER_ROLE &&
      existingMeal &&
      existingMeal.seller_id !== req.user.id
    ) {
      return res.status(403).json({ message: "You can only manage foods that you added." });
    }

    const savedImageUrl = req.file ? await saveUploadedImage(req.file) : resolvedImageUrl;
    const sellerId = req.user.role === SELLER_ROLE ? req.user.id : null;
    const savedMeal = await db.prepare(`
      INSERT INTO meals (id, name, category, description, price, stock, image_url, available_start, available_end, seller_id, availability_status, available_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description,
        price = EXCLUDED.price, stock = EXCLUDED.stock, image_url = EXCLUDED.image_url,
        available_start = EXCLUDED.available_start, available_end = EXCLUDED.available_end,
        availability_status = EXCLUDED.availability_status, available_days = COALESCE(?, meals.available_days)
      WHERE ? = ? OR meals.seller_id = ?
      RETURNING id, item_code
    `).get(
      id.trim(),
      name.trim(),
      category.trim(),
      description || "",
      parsedPrice,
      parsedStock,
      savedImageUrl,
      available_start,
      available_end,
      sellerId,
      normalizedAvailability,
      normalizedDays || DAILY_MEAL_DAYS,
      normalizedDays,
      req.user.role,
      ADMIN_ROLE,
      req.user.id
    );
    if (!savedMeal) {
      return res.status(403).json({ message: "You can only manage foods that you added." });
    }
    await syncToCsv();
    let notifications;
    let notificationError;
    try {
      const appUrl = APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      notifications = await notifyBuyersOfMealChange({
        id: id.trim(),
        name: name.trim(),
        category: category.trim(),
        price: parsedPrice,
      }, appUrl, existingMeal ? "updated" : "new");
    } catch (error) {
      console.error("Meal notifications could not be created:", error);
      notificationError = "The meal was saved, but buyer notifications could not be created.";
    }
    res.json({ success: true, item_code: savedMeal.item_code, notifications, notificationError });
  }));

  app.delete("/api/meals/:id", isStaff, asyncHandler(async (req, res) => {
    let result;
    try {
      result = await db.prepare(`
        DELETE FROM meals
        WHERE id = ? AND (? = ? OR seller_id = ?)
      `).run(req.params.id, req.user.role, ADMIN_ROLE, req.user.id);
    } catch (error) {
      if (error?.code === "23503") {
        return res.status(409).json({
          message: "This meal is linked to existing records and cannot be deleted. Keep it and set its stock to 0 instead.",
        });
      }
      throw error;
    }
    if (result.changes === 0) return res.status(404).json({ message: "Meal not found." });
    await syncToCsv();
    res.json({ success: true });
  }));

  app.get("/api/sales", isStaff, asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store, max-age=0");
    const sales = req.user.role === SELLER_ROLE
      ? await db.prepare(`
        SELECT s.*, m.name AS meal_name, m.image_url, m.seller_id AS meal_seller_id,
          a.seller_id AS assigned_seller_id, a.status AS assignment_status,
          p.status AS payment_status, p.reference AS order_reference
        FROM sales s JOIN meals m ON m.id = s.meal_id
        LEFT JOIN order_assignments a ON a.sale_id = s.id
        LEFT JOIN payments p ON p.reference = s.reference
        WHERE m.seller_id = ? OR (m.seller_id IS NULL AND (a.seller_id IS NULL OR a.seller_id = ?))
        ORDER BY s.timestamp DESC
      `).all(req.user.id, req.user.id)
      : await db.prepare(`
        SELECT s.*, m.name AS meal_name, a.seller_id AS assigned_seller_id,
          a.status AS assignment_status, p.status AS payment_status, p.reference AS order_reference
        FROM sales s LEFT JOIN meals m ON m.id = s.meal_id
        LEFT JOIN order_assignments a ON a.sale_id = s.id
        LEFT JOIN payments p ON p.reference = s.reference
        ORDER BY s.timestamp DESC
      `).all();
    res.json(sales);
  }));

  app.get("/api/my-orders", isBuyer, asyncHandler(async (req, res) => {
    const orders = await db.prepare(`
      SELECT s.id, s.meal_id, m.name AS meal_name, s.quantity, s.total_price, s.timestamp,
        s.order_status, s.pickup_time, s.pickup_date, a.status AS assignment_status, p.status AS payment_status, p.reference AS order_reference
      FROM sales s JOIN meals m ON m.id = s.meal_id
      LEFT JOIN order_assignments a ON a.sale_id = s.id
      LEFT JOIN payments p ON p.reference = s.reference
      WHERE s.user_id = ? ORDER BY s.timestamp DESC
    `).all(req.user.id);
    res.json(orders);
  }));

  app.patch("/api/sales/:id/status", isStaff, asyncHandler(async (req, res) => {
    const status = String(req.body?.status || "").toLowerCase();
    const allowed = ["accepted", "preparing", "ready", "completed", "cancelled"];
    if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid order status." });
    const update = db.transaction(async () => {
      const sale = await db.prepare(`
        SELECT s.*, m.name AS meal_name, m.seller_id AS meal_seller_id, p.status AS payment_status
        FROM sales s JOIN meals m ON m.id = s.meal_id
        LEFT JOIN payments p ON p.reference = s.reference
        WHERE s.id = ? FOR UPDATE OF s
      `).get(req.params.id);
      if (!sale) throw clientError("Order not found.", 404);
      if (sale.payment_status && sale.payment_status !== "paid") throw clientError("Only paid orders can be processed.", 409);
      let assignment = await db.prepare("SELECT * FROM order_assignments WHERE sale_id = ? FOR UPDATE").get(sale.id);
      if (!assignment) {
        await db.prepare(`INSERT INTO order_assignments (id, sale_id, seller_id, status, assigned_at, updated_at) VALUES (?, ?, ?, 'new', ?, ?)`)
          .run(crypto.randomUUID(), sale.id, sale.meal_seller_id || null, new Date().toISOString(), new Date().toISOString());
        assignment = await db.prepare("SELECT * FROM order_assignments WHERE sale_id = ? FOR UPDATE").get(sale.id);
      }
      if (req.user.role === SELLER_ROLE) {
        if (sale.meal_seller_id && sale.meal_seller_id !== req.user.id) throw clientError("This order belongs to another seller.", 403);
        if (assignment.seller_id && assignment.seller_id !== req.user.id) throw clientError("Another seller has accepted this shared order.", 409);
      }
      if (status !== "accepted" && assignment.status === "new") throw clientError("Accept this order before updating its progress.", 409);
      const now = new Date().toISOString();
      const assignedSeller = assignment.seller_id || (req.user.role === SELLER_ROLE ? req.user.id : null);
      await db.prepare("UPDATE order_assignments SET seller_id = ?, status = ?, updated_at = ? WHERE sale_id = ?")
        .run(assignedSeller, status, now, sale.id);
      await db.prepare("UPDATE sales SET order_status = ? WHERE id = ?").run(status, sale.id);
      const title = `Order ${status === "ready" ? "ready for pickup" : status}`;
      const message = `${sale.meal_name} (x${sale.quantity}) — order ${sale.reference || sale.id}.`;
      if (sale.user_id) await db.prepare(`
        INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at)
        VALUES (?, ?, 'order', ?, ?, ?, ?, ?, NULL)
      `).run(crypto.randomUUID(), sale.user_id, title, message, sale.meal_id, sale.id, now);
      return { success: true, status, seller_id: assignedSeller };
    });
    res.json(await update());
  }));

  app.post("/api/sales", isStaff, asyncHandler(async (req, res) => {
    const { meal_id, quantity, customer_name } = req.body || {};
    if (typeof meal_id !== "string" || !meal_id.trim() || !isPositiveInteger(quantity)) {
      return res.status(400).json({ message: "A meal and positive whole-number quantity are required." });
    }
    if (customer_name != null && (typeof customer_name !== "string" || customer_name.length > 120)) {
      return res.status(400).json({ message: "Customer name must be 120 characters or fewer." });
    }

    const processSale = db.transaction(async () => {
      const meal = await db.prepare("SELECT id, price, stock, availability_status FROM meals WHERE id = ? FOR UPDATE").get(meal_id.trim());
      if (!meal) throw clientError("Meal not found.", 404);
      if (meal.availability_status !== "available") throw clientError("This meal is not currently available.", 409);
      const reserved = Number((await db.prepare(`
        SELECT COALESCE(SUM(payment_items.quantity), 0) AS quantity
        FROM payment_items
        JOIN payments ON payments.reference = payment_items.reference
        WHERE payment_items.meal_id = ?
          AND payments.status = 'pending'
          AND payments.reserved_until > ?
      `).get(meal.id, new Date().toISOString())).quantity);
      if (meal.stock - reserved < Number(quantity)) throw clientError("Not enough unreserved stock.", 409);
      await db.prepare("INSERT INTO sales (id, meal_id, quantity, total_price, customer_name, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), meal.id, Number(quantity), Number(meal.price) * Number(quantity), customer_name?.trim() || req.user.name, new Date().toISOString(), req.user.id);
      await db.prepare("UPDATE meals SET stock = stock - ? WHERE id = ?").run(Number(quantity), meal.id);
    });

    try {
      await processSale();
      res.json({ success: true });
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
  }));

  app.post("/api/payments/initialize", isBuyer, paymentInitializationRateLimit, async (req, res) => {
    const reference = `ebd_${crypto.randomUUID()}`;
    let order;
    try {
      const createPayment = db.transaction(async () => {
        const now = new Date();
        const nowIso = now.toISOString();
        await db.prepare("UPDATE payments SET status = 'expired' WHERE status = 'pending' AND reserved_until <= ?")
          .run(nowIso);

        if (!Array.isArray(req.body?.cart) || req.body.cart.length === 0 || req.body.cart.length > 50) {
          throw clientError("Your cart is empty or contains too many items.");
        }
        const requestedMealIds = [...new Set(req.body.cart.map((item) =>
          String(item?.meal?.id || item?.meal_id || "").trim()
        ))].sort();
        const meals = new Map();
        for (const mealId of requestedMealIds) {
          if (!mealId) continue;
          const meal = await db.prepare("SELECT id, name, price, stock, availability_status, available_start, available_end, available_days FROM meals WHERE id = ? FOR UPDATE").get(mealId);
          if (meal) meals.set(mealId, meal);
        }
        try {
          order = buildPaymentLines(req.body.cart, (mealId) => meals.get(mealId), isTime);
        } catch (error) {
          throw clientError(error instanceof Error ? error.message : "Invalid payment order.");
        }
        const currentTime = ghanaTime(now);
        const currentDate = ghanaDate(now);
        for (const item of order.lines) {
          const meal = meals.get(item.meal_id);
          const time = item.pickup_time || currentTime;
          const date = item.pickup_time ? item.pickup_date ?? nextMealDate(meal, time, now) : currentDate;
          if (!isMealScheduled(meal, date, time) || `${date}T${time}` < `${currentDate}T${currentTime}`) {
            throw clientError(`${meal.name} is outside its ordering days or hours in Ghana time.`, 409);
          }
          item.pickup_date = item.pickup_time ? date : null;
        }

        const reservedQuantity = db.prepare(`
          SELECT COALESCE(SUM(payment_items.quantity), 0) AS quantity
          FROM payment_items
          JOIN payments ON payments.reference = payment_items.reference
          WHERE payment_items.meal_id = ?
            AND payments.status = 'pending'
            AND payments.reserved_until > ?
        `);
        const orderQuantityByMeal = new Map();
        for (const item of order.lines) {
          orderQuantityByMeal.set(item.meal_id, (orderQuantityByMeal.get(item.meal_id) || 0) + item.quantity);
        }
        for (const [mealId, quantity] of orderQuantityByMeal) {
          const meal = meals.get(mealId);
          if (meal && meal.availability_status !== "available") throw clientError("One or more meals are not currently available.", 409);
          const reserved = Number((await reservedQuantity.get(mealId, nowIso)).quantity);
          if (!meal || meal.stock < reserved + quantity) {
            throw clientError("There is not enough stock to complete this order.", 409);
          }
        }

        const reservedUntil = new Date(now.getTime() + PAYMENT_RESERVATION_MS).toISOString();
        await db.prepare(`
          INSERT INTO payments (reference, user_id, amount_kobo, status, created_at, reserved_until)
          VALUES (?, ?, ?, 'pending', ?, ?)
        `).run(reference, req.user.id, order.totalMinorUnits, nowIso, reservedUntil);
        const itemStatement = db.prepare(`
          INSERT INTO payment_items (reference, meal_id, quantity, pickup_time, pickup_date, unit_amount)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const item of order.lines) {
          await itemStatement.run(reference, item.meal_id, item.quantity, item.pickup_time, item.pickup_date, item.unit_amount);
        }
      });
      await createPayment();
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      console.error("Payment order creation failed:", error);
      return res.status(500).json({ message: "Unable to prepare checkout." });
    }

    try {
      const baseUrl = APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const initialized = await paystackRequest("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: req.user.email,
          amount: String(order.totalMinorUnits),
          currency: "GHS",
          reference,
          callback_url: `${baseUrl}/?payment=return`,
          channels: ["card", "mobile_money"],
          metadata: {
            user_id: req.user.id,
            item_count: order.lines.reduce((sum, item) => sum + item.quantity, 0),
          },
        }),
      });
      const authorizationUrl = new URL(initialized.authorization_url);
      if (
        authorizationUrl.protocol !== "https:" ||
        !["checkout.paystack.com", "paystack.com"].includes(authorizationUrl.hostname) ||
        initialized.reference !== reference
      ) {
        throw new Error("Payment provider returned invalid checkout details.");
      }
      res.json({ authorization_url: authorizationUrl.toString(), reference });
    } catch (error) {
      const status = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
      res.status(status).json({ message: error instanceof Error ? error.message : "Unable to start checkout." });
    }
  });

  app.post("/api/payments/verify/:reference", isBuyer, paymentVerificationRateLimit, async (req, res) => {
    const payment = await db.prepare("SELECT * FROM payments WHERE reference = ? AND user_id = ?")
      .get(req.params.reference, req.user.id);
    if (!payment) return res.status(404).json({ message: "Payment not found." });

    try {
      const status = await verifyAndFulfillPayment(payment.reference);
      res.json({ status });
    } catch (error) {
      console.error("Payment verification failed:", error);
      res.status(Number.isInteger(error?.statusCode) ? error.statusCode : 502).json({
        message: "Unable to confirm payment yet. Your order has not been marked paid.",
      });
    }
  });

  app.get("/api/preorders", authenticate, asyncHandler(async (req, res) => {
    const preorders = req.user.role === CUSTOMER_ROLE
      ? await db.prepare("SELECT * FROM preorders WHERE user_id = ? ORDER BY timestamp DESC").all(req.user.id)
      : req.user.role === SELLER_ROLE
        ? await db.prepare("SELECT p.*, m.name AS meal_name, m.seller_id AS meal_seller_id FROM preorders p JOIN meals m ON m.id = p.meal_id WHERE p.seller_id = ? OR (p.seller_id IS NULL AND m.seller_id IS NULL) ORDER BY p.timestamp DESC").all(req.user.id)
        : await db.prepare("SELECT * FROM preorders ORDER BY timestamp DESC").all();
    res.json(preorders);
  }));

  app.post("/api/preorders", isBuyer, asyncHandler(async (req, res) => {
    const { meal_id, quantity, pickup_time, pickup_date } = req.body || {};
    if (typeof meal_id !== "string" || !meal_id.trim() || !isPositiveInteger(quantity) || !isTime(pickup_time)) {
      return res.status(400).json({ message: "A meal, positive whole-number quantity, and valid pickup time are required." });
    }
    const meal = await db.prepare("SELECT id, seller_id, name, stock, availability_status, available_start, available_end, available_days FROM meals WHERE id = ?").get(meal_id.trim());
    if (!meal) return res.status(404).json({ message: "Meal not found." });
    const preorderId = crypto.randomUUID();
    const today = new Date();
    const date = pickup_date ?? nextMealDate(meal, pickup_time, today);
    if (meal.availability_status !== "available" || meal.stock < Number(quantity) ||
        !isMealScheduled(meal, date, pickup_time) || `${date}T${pickup_time}` < `${ghanaDate(today)}T${ghanaTime(today)}`) {
      return res.status(409).json({ message: "This meal cannot be reserved at that pickup time. Check its stock and Ghana ordering hours." });
    }
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, pickup_date, status, timestamp, user_id, seller_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(preorderId, req.user.name, meal.id, Number(quantity), pickup_time, date, "Pending", now, req.user.id, meal.seller_id || null);
    const recipients = meal.seller_id ? [{ id: meal.seller_id }] : await db.prepare("SELECT id FROM users WHERE role = ?").all(SELLER_ROLE);
    for (const recipient of recipients) {
      await db.prepare("INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at) VALUES (?, ?, 'preorder', 'New pre-order', ?, ?, ?, ?, NULL)")
        .run(crypto.randomUUID(), recipient.id, `${meal.name} (x${quantity}) requested for pickup: ${date} ${pickup_time}.`, meal.id, preorderId, now);
    }
    res.json({ success: true });
  }));

  app.patch("/api/preorders/:id", isStaff, asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    const nextStatus = ({ Ready: "Ready", Collected: "Completed" })[status] || status;
    const transitions = { Pending: ["Accepted", "Rejected", "Ready"], Accepted: ["Preparing", "Cancelled"], Preparing: ["Ready"], Ready: ["Completed", "Collected"] };
    if (!Object.values(transitions).flat().includes(nextStatus)) return res.status(400).json({ message: "Invalid pre-order status." });
    const update = db.transaction(async () => {
      const preorder = await db.prepare("SELECT p.*, m.name AS meal_name, m.seller_id AS owner_id FROM preorders p JOIN meals m ON m.id = p.meal_id WHERE p.id = ? FOR UPDATE").get(req.params.id);
      if (!preorder) throw clientError("Pre-order not found.", 404);
      if (req.user.role === SELLER_ROLE) {
        if (preorder.owner_id && preorder.owner_id !== req.user.id) throw clientError("This pre-order belongs to another seller.", 403);
        if (preorder.seller_id && preorder.seller_id !== req.user.id) throw clientError("Another seller is handling this pre-order.", 409);
      }
      if (!(transitions[preorder.status] || []).includes(nextStatus)) throw clientError("This pre-order status has already changed.", 409);
      const now = new Date().toISOString();
      const sellerId = preorder.seller_id || (req.user.role === SELLER_ROLE ? req.user.id : preorder.owner_id);
      await db.prepare("UPDATE preorders SET status = ?, seller_id = ? WHERE id = ? AND status = ? AND (seller_id IS NULL OR seller_id = ?)")
        .run(nextStatus, sellerId || null, preorder.id, preorder.status, req.user.id);
      if (preorder.user_id) await db.prepare("INSERT INTO user_notifications (id, user_id, type, title, message, meal_id, related_id, timestamp, read_at) VALUES (?, ?, 'preorder', ?, ?, ?, ?, ?, NULL)")
        .run(crypto.randomUUID(), preorder.user_id, `Pre-order ${nextStatus.toLowerCase()}`, `${preorder.meal_name} (x${preorder.quantity}) for ${[preorder.pickup_date, preorder.pickup_time].filter(Boolean).join(" ")} is ${nextStatus.toLowerCase()}.`, preorder.meal_id, preorder.id, now);
      return { success: true, status: nextStatus };
    });
    res.json(await update());
  }));

  app.get("/api/feedback", authenticate, asyncHandler(async (req, res) => {
    const feedback = await db.prepare("SELECT * FROM feedback ORDER BY timestamp DESC").all();
    res.json(feedback);
  }));

  app.post("/api/feedback", authenticate, asyncHandler(async (req, res) => {
    const { meal_id, rating, comment } = req.body || {};
    if (
      typeof meal_id !== "string" || !meal_id.trim() ||
      !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5 ||
      typeof comment !== "string" || !comment.trim() || comment.length > 2000
    ) {
      return res.status(400).json({ message: "Provide a meal, a rating from 1 to 5, and a comment of at most 2,000 characters." });
    }
    const meal = await db.prepare("SELECT id FROM meals WHERE id = ?").get(meal_id.trim());
    if (!meal) return res.status(404).json({ message: "Meal not found." });
    await db.prepare("INSERT INTO feedback (id, customer_name, meal_id, rating, comment, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), req.user.name, meal.id, Number(rating), comment.trim(), new Date().toISOString(), req.user.id);
    res.json({ success: true });
  }));

  app.get("/api/notifications", authenticate, asyncHandler(async (req, res) => {
    if (req.user.role === CUSTOMER_ROLE) {
      const notifications = await db.prepare(`
        SELECT id, type, title, message, meal_id, timestamp, read_at
        FROM user_notifications
        WHERE user_id = ?
        ORDER BY timestamp DESC
      `).all(req.user.id);
      return res.json(notifications);
    }
    if (req.user.role === SELLER_ROLE) {
      const notifications = await db.prepare(`
        SELECT id, type, title, message, meal_id, related_id, timestamp, read_at
        FROM user_notifications WHERE user_id = ? ORDER BY timestamp DESC
      `).all(req.user.id);
      return res.json(notifications);
    }
    if (![ADMIN_ROLE, SELLER_ROLE].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const notifications = await db.prepare("SELECT * FROM notifications ORDER BY timestamp DESC").all();
    res.json(notifications);
  }));

  app.post("/api/notifications/read", authenticate, asyncHandler(async (req, res) => {
    const readAt = new Date().toISOString();
    const { id } = req.body || {};

    if (id) {
      await db.prepare(`
        UPDATE user_notifications
        SET read_at = ?
        WHERE (id::text = ?::text OR id = ?) AND user_id = ?
      `).run(readAt, String(id).trim(), String(id).trim(), req.user.id);
    } else {
      await db.prepare(`
        UPDATE user_notifications
        SET read_at = ?
        WHERE user_id = ?
      `).run(readAt, req.user.id);
    }

    res.json({ success: true, readAt });
  }));

  app.post("/api/notifications/:id/read", authenticate, asyncHandler(async (req, res) => {
    const readAt = new Date().toISOString();
    const id = String(req.params.id).trim();

    await db.prepare(`
      UPDATE user_notifications
      SET read_at = ?
      WHERE (id::text = ?::text OR id = ?) AND user_id = ?
    `).run(readAt, id, id, req.user.id);

    res.json({ success: true, readAt });
  }));


  app.get("/api/notification-preferences", isBuyer, asyncHandler(async (req, res) => {
    const preferences = await db.prepare(`
      SELECT phone, meal_email_opt_in, meal_sms_opt_in
      FROM users
      WHERE id = ?
    `).get(req.user.id);
    res.json({
      phone: preferences.phone || "",
      email_opt_in: preferences.meal_email_opt_in,
      sms_opt_in: preferences.meal_sms_opt_in,
    });
  }));

  app.put("/api/notification-preferences", isBuyer, asyncHandler(async (req, res) => {
    const { phone, email_opt_in, sms_opt_in } = req.body || {};
    if (
      typeof phone !== "string" ||
      typeof email_opt_in !== "boolean" ||
      typeof sms_opt_in !== "boolean"
    ) {
      return res.status(400).json({ message: "Provide a phone number and email/SMS notification choices." });
    }
    const normalizedPhone = phone.trim();
    if (
      (sms_opt_in && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) ||
      (!sms_opt_in && normalizedPhone && !/^\+[1-9]\d{7,14}$/.test(normalizedPhone))
    ) {
      return res.status(400).json({ message: "Enter the phone number in international format, such as +233241234567." });
    }
    await db.prepare(`
      UPDATE users
      SET phone = ?, meal_email_opt_in = ?, meal_sms_opt_in = ?
      WHERE id = ?
    `).run(normalizedPhone || null, email_opt_in, sms_opt_in, req.user.id);
    res.json({ success: true });
  }));

  app.post("/api/notifications", isStaff, asyncHandler(async (req, res) => {
    const { message, recipients_count, channel } = req.body || {};
    if (
      typeof message !== "string" || !message.trim() || message.length > 2000 ||
      !Number.isSafeInteger(Number(recipients_count)) || Number(recipients_count) < 0 ||
      !["SMS", "Email"].includes(channel)
    ) {
      return res.status(400).json({ message: "Provide a message, recipient count, and SMS or Email channel." });
    }
    await db.prepare("INSERT INTO notifications (id, message, recipients_count, channel, timestamp) VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), message.trim(), Number(recipients_count), channel, new Date().toISOString());
    res.json({ success: true });
  }));

  app.get("/api/auth/options", (req, res) => {
    res.json({ passwordRegistration: !verifiedBuyersOnly });
  });

  app.post("/api/register", registrationRateLimit, asyncHandler(async (req, res) => {
    if (verifiedBuyersOnly) return res.status(403).json({ message: "Use Sign in with Google to create a verified Buyer account." });
    const { name, email, password, role } = req.body || {};

    if (role != null && role !== CUSTOMER_ROLE) {
      return res.status(400).json({ message: "New accounts are limited to the Buyer role." });
    }

    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(name).trim();

    if (
      !trimmedName || trimmedName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 254 ||
      password.length < 10 || password.length > 128
    ) {
      return res.status(400).json({ message: "Provide a valid name, email, and password with 10 to 128 characters." });
    }

    const existingUser = await db.prepare("SELECT id FROM users WHERE email = ?").get(trimmedEmail);
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const userId = crypto.randomUUID();
    const user = {
      id: userId,
      name: trimmedName,
      email: trimmedEmail,
      role: CUSTOMER_ROLE,
      password: await hashPassword(password),
    };

    const insertedUser = await db.prepare(`
      INSERT INTO users (id, name, email, role, password)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `).get(
      user.id,
      user.name,
      user.email,
      user.role,
      user.password
    );
    if (!insertedUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    await createSession(user, res);
    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }));

app.get("/api/sellers", isAdmin, asyncHandler(async (req, res) => {
  const sellers = await db.prepare(`
    SELECT id, name, email, phone
    FROM users
    WHERE role = ?
    ORDER BY name ASC
  `).all(SELLER_ROLE);

  return res.json({
    success: true,
    sellers,
  });
}));




  app.post("/api/sellers", isAdmin, asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "Name, email, and temporary password are required." });
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    if (
      !trimmedName || trimmedName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail) || trimmedEmail.length > 254 ||
      password.length < 10 || password.length > 128
    ) {
      return res.status(400).json({
        message: "Provide a valid name, email, and temporary password with 10 to 128 characters.",
      });
    }

    const sellerId = crypto.randomUUID();
    const insertedSeller = await db.prepare(`
      INSERT INTO users (id, name, email, role, password)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, name, email, role
    `).get(
      sellerId,
      trimmedName,
      trimmedEmail,
      SELLER_ROLE,
      await hashPassword(password)
    );
    if (!insertedSeller) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    return res.status(201).json({ success: true, user: insertedSeller });
  }));

  app.patch("/api/sellers/:id", isAdmin, asyncHandler(async (req, res) => {
    const { name, email, phone, password } = req.body || {};
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
    if (
      !normalizedName || normalizedName.length > 120 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254 ||
      normalizedPhone.length > 40 ||
      (password != null && password !== "" && (typeof password !== "string" || password.length < 10 || password.length > 128))
    ) {
      return res.status(400).json({ message: "Provide a valid seller name, email, phone number, and optional password of 10 to 128 characters." });
    }
    const seller = await db.prepare("SELECT id FROM users WHERE id = ? AND role = ?").get(req.params.id, SELLER_ROLE);
    if (!seller) return res.status(404).json({ message: "Seller account not found." });
    const emailOwner = await db.prepare("SELECT id FROM users WHERE email = ? AND id <> ?").get(normalizedEmail, seller.id);
    if (emailOwner) return res.status(409).json({ message: "An account with this email already exists." });
    const updated = await db.transaction(async () => {
      if (!password) {
        return db.prepare(`UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ? AND role = ? RETURNING id, name, email, phone`)
          .get(normalizedName, normalizedEmail, normalizedPhone || null, seller.id, SELLER_ROLE);
      }
      const account = await db.prepare(`UPDATE users SET name = ?, email = ?, phone = ?, password = ? WHERE id = ? AND role = ? RETURNING id, name, email, phone`)
        .get(normalizedName, normalizedEmail, normalizedPhone || null, await hashPassword(password), seller.id, SELLER_ROLE);
      if (account) await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(account.id);
      return account;
    })();
    return res.json({ success: true, seller: updated });
  }));

  app.delete("/api/sellers/:id", isAdmin, asyncHandler(async (req, res) => {
    const deleted = await db.prepare("DELETE FROM users WHERE id = ? AND role = ? RETURNING id, name, email")
      .get(req.params.id, SELLER_ROLE);
    if (!deleted) return res.status(404).json({ message: "Seller account not found." });
    return res.json({ success: true, seller: deleted });
  }));

  const googleCookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
  const googleCookie = googleCookieOptions.secure ? "__Host-ebd_google" : "ebd_google";

  const startGoogleAuthorization = (res) => {
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(32).toString("base64url");
    res.cookie(googleCookie, `${state}.${verifier}`, {
      ...googleCookieOptions,
      maxAge: 10 * 60 * 1000,
    });
    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.search = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: googleRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    return authorize.href;
  };

  app.get("/api/auth/google", loginRateLimit, (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!googleRedirectUri) return res.redirect("/?google_signin=unavailable");
    const origin = new URL(googleRedirectUri).origin;
    if (`${req.protocol}://${req.get("host")}` !== origin) {
      return res.redirect(`${origin}/api/auth/google`);
    }
    return res.redirect(startGoogleAuthorization(res));
  });

  app.get(googleCallbackPath, loginRateLimit, asyncHandler(async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.clearCookie(googleCookie, googleCookieOptions);
    if (!googleRedirectUri) return res.redirect("/?google_signin=unavailable");

    const transaction = (req.headers.cookie || "").match(
      new RegExp(`(?:^|;\\s*)${googleCookie}=([A-Za-z0-9_-]{43})\\.([A-Za-z0-9_-]{43})(?:;|$)`)
    );
    const failGoogleSignIn = (reason) => {
      console.warn(`Google sign-in failed: ${reason}`);
      return res.redirect("/?google_signin=failed");
    };
    if (req.query.error === "access_denied") return failGoogleSignIn("Google access denied");
    if (!transaction || req.query.state !== transaction[1] || typeof req.query.code !== "string") {
      return failGoogleSignIn(!transaction ? "sign-in cookie missing" :
        req.query.state !== transaction[1] ? "state mismatch" : "authorization code missing");
    }
    let profile;
    let googleStage = "token exchange";
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: googleRedirectUri,
          grant_type: "authorization_code",
          code: req.query.code,
          code_verifier: transaction[2],
        }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!tokenResponse.ok) {
        const { error } = await tokenResponse.json().catch(() => ({}));
        const knownErrors = ["invalid_client", "invalid_grant", "invalid_request", "redirect_uri_mismatch", "unauthorized_client"];
        return failGoogleSignIn(`token exchange rejected (HTTP ${tokenResponse.status}${knownErrors.includes(error) ? `, ${error}` : ""})`);
      }
      const { access_token: accessToken } = await tokenResponse.json();
      if (typeof accessToken !== "string" || !accessToken) return failGoogleSignIn("access token missing");
      googleStage = "profile lookup";
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!profileResponse.ok) return failGoogleSignIn(`profile lookup rejected (HTTP ${profileResponse.status})`);
      profile = await profileResponse.json();
    } catch (error) {
      const detail = error.name === "TimeoutError" ? "timed out" :
        error instanceof SyntaxError ? "returned invalid JSON" : "request failed";
      return failGoogleSignIn(`${googleStage} ${detail}`);
    }

    const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
    if (typeof profile?.sub !== "string" || !profile.sub || profile.sub.length > 255 ||
        profile.email_verified !== true || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return failGoogleSignIn("Google profile missing a verified email or valid subject");
    }

    const findGoogleUser = db.prepare("SELECT id FROM users WHERE google_subject = ?");
    let user = await findGoogleUser.get(profile.sub);
    if (!user) {
      const name = (typeof profile.name === "string" && profile.name.trim().slice(0, 120)) || email.slice(0, 120);
      user = await db.prepare(`
        INSERT INTO users (id, name, email, role, google_subject)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
        RETURNING id
      `).get(crypto.randomUUID(), name, email, CUSTOMER_ROLE, profile.sub);
      user ||= await findGoogleUser.get(profile.sub);
      if (!user) return res.redirect("/?google_signin=existing");
    }

    await createSession(user, res);
    return res.redirect("/");
  }));

  app.post("/api/login", loginRateLimit, asyncHandler(async (req, res) => {
    const { email, password, role, mfaCode, enrollment } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string" ||
        !email.trim() || email.length > 254 || !password || password.length > 128) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(trimmedEmail);

    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (role && (!["Admin", "Seller", "Buyer"].includes(role) || user.role !== role)) {
      return res.status(401).json({ message: "This account is not allowed for the selected role." });
    }
    if (verifiedBuyersOnly && user.role === CUSTOMER_ROLE && !user.google_subject) {
      return res.status(403).json({ message: "This Buyer account needs verified Google sign-in. Contact the cafeteria for help with your existing account." });
    }
    const auditContext = requestContext.getStore();
    if (auditContext) auditContext.actorId = user.id;
    const requiresMfa = Boolean(mfaKey && [ADMIN_ROLE, SELLER_ROLE].includes(user.role));
    if (requiresMfa) {
      res.set("Cache-Control", "no-store");
      const existing = await db.prepare("SELECT encrypted_secret FROM staff_mfa WHERE user_id = ?").get(user.id);
      const secretPurpose = `staff-mfa:${user.id}`;
      const enrollmentPurpose = `staff-enrollment:${user.id}:${crypto.createHash("sha256").update(user.password).digest("hex")}`;
      if (!mfaCode) {
        if (existing) return res.status(202).json({ mfaRequired: true });
        const secret = createMfaSecret();
        const sealed = sealMfa({ secret, expires: Date.now() + 5 * 60 * 1000 }, mfaKey, enrollmentPurpose);
        return res.status(202).json({ mfaRequired: true, enrollment: sealed, setupKey: secret });
      }

      const setup = !existing && unsealMfa(enrollment, mfaKey, enrollmentPurpose);
      if (!existing && (!setup || setup.expires <= Date.now())) {
        return res.status(400).json({ message: "Authenticator setup expired. Go back and sign in again." });
      }
      const secret = existing ? unsealMfa(existing.encrypted_secret, mfaKey, secretPurpose) : setup.secret;
      const counter = matchingMfaCounter(secret, mfaCode);
      if (counter === null) return res.status(401).json({ message: "The authenticator code is invalid or expired." });
      const accepted = existing
        ? await db.prepare("UPDATE staff_mfa SET last_counter = ? WHERE user_id = ? AND last_counter < ?")
          .run(counter, user.id, counter)
        : await db.prepare("INSERT INTO staff_mfa (user_id, encrypted_secret, last_counter) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
          .run(user.id, sealMfa(secret, mfaKey, secretPurpose), counter);
      if (!accepted.changes) return res.status(401).json({ message: "Use a new authenticator code and try again." });
    }

    if (!user.password.startsWith("$argon2id$")) {
      const upgraded = await db.prepare("UPDATE users SET password = ? WHERE id = ? AND password = ?")
        .run(await hashPassword(password), user.id, user.password);
      if (upgraded.changes === 0) {
        const current = await db.prepare("SELECT password FROM users WHERE id = ?").get(user.id);
        if (!current || !(await verifyPassword(password, current.password))) {
          return res.status(401).json({ message: "Invalid email or password." });
        }
      }
    }

    await createSession(user, res, requiresMfa);
    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  }));

  app.get("/api/session", authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  app.post("/api/logout", asyncHandler(async (req, res) => {
    await clearSession(req, res);
    res.json({ success: true });
  }));

  app.use("/api", (req, res) => {
    res.status(404).json({ message: "API route not found." });
  });

  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        message: status === 413 ? "Image must be 5 MB or smaller." : "Upload a JPG, PNG, or WebP image.",
      });
    }
    const statusCode = Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
      ? error.statusCode
      : 500;
    if (statusCode >= 500) console.error("Unhandled request error:", error);
    res.status(statusCode).json({
      message: statusCode === 500 ? "An unexpected server error occurred." : error.message,
    });
  });

  const serveBuiltApp = () => {
    app.use(express.static("public"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("public/index.html"));
    });
  };

  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const hmrEnabled = Boolean(httpServer) && process.env.DISABLE_HMR !== "true";
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: hmrEnabled ? { server: httpServer } : false,
          ...(hmrEnabled ? {} : { ws: false }),
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.locals.closeVite = () => vite.close();
    } catch (error) {
      const distIndex = path.resolve("public/index.html");
      if (!fs.existsSync(distIndex)) {
        throw error;
      }

      console.warn("Vite dev server unavailable, serving built dist instead.");
      serveBuiltApp();
    }
  } else if (!isVercel) {
    serveBuiltApp();
  }

  return app;
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  const server = createHttpServer();
  const app = await createApp(express, server);
  server.on("request", app);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; closing server.`);
    clearInterval(sessionCleanup);
    clearInterval(rateLimitCleanup);
    app.locals.closeVite?.().catch((error) => {
      console.error("Vite shutdown failed:", error);
      process.exitCode = 1;
    });
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed:", error);
        process.exitCode = 1;
      }
      activePool.end().catch((poolError) => {
        console.error("PostgreSQL pool shutdown failed:", poolError);
        process.exitCode = 1;
      });
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(async (error) => {
    console.error("Server startup failed:", error);
    if (activePool) {
      try {
        await activePool.end();
      } catch (poolError) {
        console.error("PostgreSQL pool cleanup failed:", poolError);
      }
    }
    process.exitCode = 1;
  });
}
