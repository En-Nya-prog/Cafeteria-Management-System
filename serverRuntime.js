import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { createObjectCsvWriter } from "csv-writer";
import { put } from "@vercel/blob";
import pg from "pg";
import { getTrustedOrigins } from "./lib/requestOrigins.js";
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

export async function createApp(expressFramework = express) {
  const app = expressFramework();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must point to a PostgreSQL database.");
  }
  const pool = activePool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: isVercel ? 1 : 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error:", error));
  const transactionContext = new AsyncLocalStorage();
  const toPostgresParameters = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  const query = (sql, params = []) => {
    const executor = transactionContext.getStore() || pool;
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
    close: () => pool.end(),
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

  const hashPassword = (password) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
  };

  const verifyPassword = (password, storedPassword) => {
    if (!storedPassword || !storedPassword.includes(":")) {
      return false;
    }

    const [salt, hash] = storedPassword.split(":");
    if (!salt || !hash) {
      return false;
    }

    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
    } catch (error) {
      return false;
    }
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
      { id: "name", title: "name" },
      { id: "category", title: "category" },
      { id: "description", title: "description" },
      { id: "price", title: "price" },
      { id: "stock", title: "stock" },
      { id: "image_url", title: "image_url" },
      { id: "available_start", title: "available_start" },
      { id: "available_end", title: "available_end" },
    ],
  });

  const syncToCsv = async () => {
    if (isVercel) return;
    const meals = await db.prepare("SELECT * FROM meals").all();
    await csvWriter.writeRecords(meals);
  };

  await db.exec(`
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price DOUBLE PRECISION NOT NULL,
      stock INTEGER NOT NULL,
      image_url TEXT,
      available_start TEXT,
      available_end TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      meal_id TEXT,
      quantity INTEGER,
      total_price DOUBLE PRECISION,
      customer_name TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS preorders (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      meal_id TEXT,
      quantity INTEGER,
      pickup_time TEXT,
      status TEXT DEFAULT 'Pending',
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      customer_name TEXT,
      meal_id TEXT,
      rating INTEGER,
      comment TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      message TEXT,
      recipients_count INTEGER,
      channel TEXT,
      timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      role TEXT,
      password TEXT
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      meal_id TEXT,
      timestamp TEXT NOT NULL,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      reference TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_kobo INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reserved_until TEXT NOT NULL,
      verified_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payment_items (
      id BIGSERIAL PRIMARY KEY,
      reference TEXT NOT NULL,
      meal_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      pickup_time TEXT,
      unit_amount INTEGER NOT NULL,
      FOREIGN KEY (reference) REFERENCES payments(reference) ON DELETE CASCADE
    );
  `);

  for (const table of ["sales", "preorders", "feedback"]) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_id TEXT`);
  }
  await db.exec(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS meal_email_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS meal_sms_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS user_notifications_user_timestamp_idx
      ON user_notifications (user_id, timestamp DESC);
  `);
  await db.exec("ALTER TABLE meals ADD COLUMN IF NOT EXISTS seller_id TEXT REFERENCES users(id) ON DELETE SET NULL");
  await db.exec(`
    CREATE INDEX IF NOT EXISTS payments_reservations_idx ON payments (status, reserved_until);
    CREATE INDEX IF NOT EXISTS payment_items_meal_idx ON payment_items (meal_id);
    CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions (expires_at);
    CREATE INDEX IF NOT EXISTS rate_limits_expiration_idx ON rate_limits (reset_at);
    CREATE INDEX IF NOT EXISTS meals_seller_id_idx ON meals (seller_id);
  `);
await db.exec(`
  CREATE TABLE IF NOT EXISTS seller_order_notification_deliveries (
    reference TEXT NOT NULL REFERENCES payments(reference) ON DELETE CASCADE,
    seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
    status TEXT NOT NULL DEFAULT 'sending'
      CHECK (status IN ('sending', 'sent', 'failed')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (reference, seller_id, channel)
  );
`);



  const userCount = await db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (Number(userCount.count) === 0 && process.env.NODE_ENV !== "production") {
    const userStmt = db.prepare("INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)");
    await userStmt.run("user-admin", "Administrator", "admin@ebd.com", ADMIN_ROLE, hashPassword("admin123"));
    await userStmt.run("user-seller", "Seller", "seller@ebd.com", SELLER_ROLE, hashPassword("seller123"));
    await userStmt.run("user-customer", "Customer", "student@ebd.com", CUSTOMER_ROLE, hashPassword("student123"));
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
        hashPassword(adminPassword)
      );
    } else if (Number(userCount.count) === 0) {
      throw new Error("Set EBD_ADMIN_EMAIL and EBD_ADMIN_PASSWORD to bootstrap a production administrator.");
    }

    const legacyAdmin = await db.prepare("SELECT id, email, password FROM users WHERE id = ? OR email = ?")
      .get("user-admin", "admin@ebd.com");
    if (legacyAdmin && verifyPassword("admin123", legacyAdmin.password)) {
      if (!hasBootstrapConfig) {
        throw new Error("The default administrator password is still active. Set EBD_ADMIN_EMAIL and EBD_ADMIN_PASSWORD to rotate it.");
      }
      const emailOwner = await db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(adminEmail, legacyAdmin.id);
      if (emailOwner) throw new Error("EBD_ADMIN_EMAIL is already assigned to another account.");
      await db.prepare("UPDATE users SET email = ?, password = ?, role = ? WHERE id = ?").run(
        adminEmail,
        hashPassword(adminPassword),
        ADMIN_ROLE,
        legacyAdmin.id
      );
    }

    for (const [id, email, password] of [
      ["user-seller", "seller@ebd.com", "seller123"],
      ["user-customer", "student@ebd.com", "student123"],
    ]) {
      const legacyUser = await db.prepare("SELECT id, password FROM users WHERE id = ? OR email = ?").get(id, email);
      if (legacyUser && verifyPassword(password, legacyUser.password)) {
        await db.prepare("DELETE FROM users WHERE id = ?").run(legacyUser.id);
      }
    }
  }

  const mealCount = await db.prepare("SELECT COUNT(*) as count FROM meals").get();
  if (Number(mealCount.count) === 0 && process.env.NODE_ENV !== "production") {
    const categories = ["Breakfast Meals", "Lunch Meals", "Snacks", "Beverages", "Desserts"];
    const stmt = db.prepare("INSERT INTO meals (id, name, category, description, price, stock, image_url, available_start, available_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");

    for (let i = 1; i <= 50; i++) {
      const cat = categories[Math.floor(Math.random() * categories.length)];
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

      await stmt.run(
        `meal-${i}`,
        `${cat} Option ${i}`,
        cat,
        `Freshly prepared ${cat.toLowerCase()} special`,
        (Math.random() * 30 + 5).toFixed(2),
        Math.floor(Math.random() * 100),
        `https://picsum.photos/seed/meal${i}/400/300`,
        start,
        end
      );
    }
  } else if (Number(mealCount.count) === 0) {
    console.warn("The production menu is empty. Add meals using the admin account after deployment.");
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
      SELECT users.id, users.name, users.email, users.role, sessions.expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
    `).get(tokenHash);

    if (!session || Date.parse(session.expires_at) <= Date.now()) {
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }

    req.user = {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role,
    };
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

  const createSession = async (user, res) => {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
      tokenHash,
      user.id,
      expiresAt
    );
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader(
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
  const isTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

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
      INSERT INTO sales (id, meal_id, quantity, total_price, customer_name, timestamp, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const preorderStatement = db.prepare(`
      INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, status, timestamp, user_id)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
    `);
    for (const item of items) {
      await saleStatement.run(
        crypto.randomUUID(),
        item.meal_id,
        item.quantity,
        (item.unit_amount * item.quantity) / 100,
        user.name,
        now,
        payment.user_id
      );
      if (item.pickup_time) {
        await preorderStatement.run(
          crypto.randomUUID(),
          user.name,
          item.meal_id,
          item.quantity,
          item.pickup_time,
          now,
          payment.user_id
        );
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
    const inventory = req.user.role === SELLER_ROLE
      ? await db.prepare("SELECT * FROM meals WHERE seller_id = ? ORDER BY name").all(req.user.id)
      : await db.prepare("SELECT * FROM meals ORDER BY name").all();
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
    } = req.body;

    const resolvedImageUrl = image_url || imageUrl || null;

    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    if (
      typeof id !== "string" || !id.trim() ||
      typeof name !== "string" || !name.trim() || name.length > 120 ||
      typeof category !== "string" || !category.trim() || category.length > 80 ||
      !Number.isFinite(parsedPrice) || parsedPrice < 0 ||
      !Number.isSafeInteger(parsedStock) || parsedStock < 0 ||
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
      INSERT INTO meals (id, name, category, description, price, stock, image_url, available_start, available_end, seller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description,
        price = EXCLUDED.price, stock = EXCLUDED.stock, image_url = EXCLUDED.image_url,
        available_start = EXCLUDED.available_start, available_end = EXCLUDED.available_end
      WHERE ? = ? OR meals.seller_id = ?
      RETURNING id
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
    res.json({ success: true, notifications, notificationError });
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
    const sales = await db.prepare("SELECT * FROM sales ORDER BY timestamp DESC").all();
    res.json(sales);
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
      const meal = await db.prepare("SELECT id, price, stock FROM meals WHERE id = ? FOR UPDATE").get(meal_id.trim());
      if (!meal) throw clientError("Meal not found.", 404);
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
          const meal = await db.prepare("SELECT id, price, stock FROM meals WHERE id = ? FOR UPDATE").get(mealId);
          if (meal) meals.set(mealId, meal);
        }
        try {
          order = buildPaymentLines(req.body.cart, (mealId) => meals.get(mealId), isTime);
        } catch (error) {
          throw clientError(error instanceof Error ? error.message : "Invalid payment order.");
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
          INSERT INTO payment_items (reference, meal_id, quantity, pickup_time, unit_amount)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const item of order.lines) {
          await itemStatement.run(reference, item.meal_id, item.quantity, item.pickup_time, item.unit_amount);
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
      : await db.prepare("SELECT * FROM preorders ORDER BY timestamp DESC").all();
    res.json(preorders);
  }));

  app.post("/api/preorders", isBuyer, asyncHandler(async (req, res) => {
    const { meal_id, quantity, pickup_time } = req.body || {};
    if (typeof meal_id !== "string" || !meal_id.trim() || !isPositiveInteger(quantity) || !isTime(pickup_time)) {
      return res.status(400).json({ message: "A meal, positive whole-number quantity, and valid pickup time are required." });
    }
    const meal = await db.prepare("SELECT id FROM meals WHERE id = ?").get(meal_id.trim());
    if (!meal) return res.status(404).json({ message: "Meal not found." });
    await db.prepare("INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, status, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), req.user.name, meal.id, Number(quantity), pickup_time, "Pending", new Date().toISOString(), req.user.id);
    res.json({ success: true });
  }));

  app.patch("/api/preorders/:id", isStaff, asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!["Ready", "Collected"].includes(status)) {
      return res.status(400).json({ message: "Status must be Ready or Collected." });
    }
    const expectedStatus = status === "Ready" ? "Pending" : "Ready";
    const result = await db.prepare("UPDATE preorders SET status = ? WHERE id = ? AND status = ?")
      .run(status, req.params.id, expectedStatus);
    if (result.changes === 0) {
      const preorder = await db.prepare("SELECT id FROM preorders WHERE id = ?").get(req.params.id);
      return res.status(preorder ? 409 : 404).json({
        message: preorder ? "Pre-order status has already changed." : "Pre-order not found.",
      });
    }
    res.json({ success: true });
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
        SELECT id, type, title, message, timestamp, read_at
        FROM user_notifications
        WHERE user_id = ?
        ORDER BY timestamp DESC
      `).all(req.user.id);
      return res.json(notifications);
    }
    if (![ADMIN_ROLE, SELLER_ROLE].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const notifications = await db.prepare("SELECT * FROM notifications ORDER BY timestamp DESC").all();
    res.json(notifications);
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

  app.post("/api/register", registrationRateLimit, asyncHandler(async (req, res) => {
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
      password: hashPassword(password),
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
      hashPassword(password)
    );
    if (!insertedSeller) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    return res.status(201).json({ success: true, user: insertedSeller });
  }));

  app.post("/api/login", loginRateLimit, asyncHandler(async (req, res) => {
    const { email, password, role } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(trimmedEmail);

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (role && (!["Admin", "Seller", "Buyer"].includes(role) || user.role !== role)) {
      return res.status(401).json({ message: "This account is not allowed for the selected role." });
    }

    await createSession(user, res);
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
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
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
  const app = await createApp();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; closing server.`);
    clearInterval(sessionCleanup);
    clearInterval(rateLimitCleanup);
    server.close((error) => {
      if (error) {
        console.error("HTTP server shutdown failed:", error);
        process.exitCode = 1;
      }
      db.close().catch((poolError) => {
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
