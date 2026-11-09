import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { createObjectCsvWriter } from "csv-writer";

const uploadsDir = path.resolve("uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const csvPath = path.resolve("products.csv");

async function startServer() {
  const app = express();
  const PORT = 3000;
  const db = new Database("cafeteria.db");
  const ADMIN_ROLE = "Admin";
  const SELLER_ROLE = "Seller";
  const CUSTOMER_ROLE = "Buyer";
  const validRoles = [ADMIN_ROLE, SELLER_ROLE, CUSTOMER_ROLE];

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

  app.use((req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      process.env.NODE_ENV === "production"
        ? "script-src 'self'"
        : "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    );
    next();
  });

  const csvWriter = createObjectCsvWriter({
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

  const syncToCsv = () => {
    const meals = db.prepare("SELECT * FROM meals").all();
    csvWriter.writeRecords(meals).catch((err) => console.error("CSV Write Error:", err));
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS meals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL,
      image_url TEXT,
      available_start TEXT,
      available_end TEXT
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      meal_id TEXT,
      quantity INTEGER,
      total_price REAL,
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
  `);

  const mealColumns = db.prepare("PRAGMA table_info(meals)").all();
  if (!mealColumns.some((column) => column.name === "description")) {
    db.exec("ALTER TABLE meals ADD COLUMN description TEXT");
  }

  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (userCount.count === 0) {
    const userStmt = db.prepare("INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)");
    userStmt.run("user-admin", "Administrator", "admin@ebd.com", ADMIN_ROLE, hashPassword("admin123"));
    userStmt.run("user-seller", "Seller", "seller@ebd.com", SELLER_ROLE, hashPassword("seller123"));
    userStmt.run("user-customer", "Customer", "student@ebd.com", CUSTOMER_ROLE, hashPassword("student123"));
  }

  const mealCount = db.prepare("SELECT COUNT(*) as count FROM meals").get();
  if (mealCount.count === 0) {
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

      stmt.run(
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
  }

  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  const getRequestRole = (req) => {
    const roleHeader = req.headers["x-user-role"];

    if (Array.isArray(roleHeader)) {
      return roleHeader[0] || "";
    }

    return typeof roleHeader === "string" ? roleHeader : "";
  };

  const requireRoles = (allowedRoles) => {
    return (req, res, next) => {
      const role = getRequestRole(req);

      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      next();
    };
  };

  const isAdmin = requireRoles([ADMIN_ROLE]);
  const isStaff = requireRoles([ADMIN_ROLE, SELLER_ROLE]);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  });
  const upload = multer({ storage });

  app.get("/api/meals", (req, res) => {
    const meals = db.prepare("SELECT * FROM meals").all();
    res.json(meals);
  });

  app.get("/api/inventory", isAdmin, (req, res) => {
    const inventory = db.prepare("SELECT * FROM meals").all();
    res.json(inventory);
  });

  app.get("/api/inventory/low-stock", isStaff, (req, res) => {
    const meals = db.prepare("SELECT * FROM meals").all();
    const lowStock = meals.filter((meal) => {
      const stock = Number(meal.stock ?? 0);
      const threshold = Number(meal.minimum_threshold ?? meal.lowStockThreshold ?? 10);
      return stock <= threshold;
    });

    res.json(lowStock);
  });

  app.post("/api/upload", isAdmin, upload.single("image"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ url: imageUrl, imageUrl });
  });

  app.post("/api/meals", isAdmin, upload.single("image"), (req, res) => {
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

    const resolvedImageUrl = req.file
      ? `/uploads/${req.file.filename}`
      : image_url || imageUrl || null;

    const stmt = db.prepare("INSERT OR REPLACE INTO meals (id, name, category, description, price, stock, image_url, available_start, available_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    stmt.run(
      id,
      name,
      category,
      description || "",
      Number(price),
      Number(stock),
      resolvedImageUrl,
      available_start,
      available_end
    );
    syncToCsv();
    res.json({ success: true });
  });

  app.delete("/api/meals/:id", isAdmin, (req, res) => {
    db.prepare("DELETE FROM meals WHERE id = ?").run(req.params.id);
    syncToCsv();
    res.json({ success: true });
  });

  app.get("/api/sales", (req, res) => {
    const sales = db.prepare("SELECT * FROM sales ORDER BY timestamp DESC").all();
    res.json(sales);
  });

  app.post("/api/sales", (req, res) => {
    const { id, meal_id, quantity, total_price, customer_name, timestamp } = req.body;
    const stmt = db.prepare("INSERT INTO sales (id, meal_id, quantity, total_price, customer_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(id, meal_id, quantity, total_price, customer_name, timestamp);

    db.prepare("UPDATE meals SET stock = stock - ? WHERE id = ?").run(quantity, meal_id);

    res.json({ success: true });
  });

  app.post("/api/pay", (req, res) => {
    const { phone, cart, customer_name } = req.body;
    const normalizedPhone = String(phone || "").replace(/\D/g, "");

    if (!normalizedPhone || normalizedPhone.length < 10) {
      return res.status(400).json({ message: "Enter a valid MoMo number" });
    }

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ message: "Your cart is empty" });
    }

    const getMeal = db.prepare("SELECT * FROM meals WHERE id = ?");
    const saleStmt = db.prepare("INSERT INTO sales (id, meal_id, quantity, total_price, customer_name, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
    const preorderStmt = db.prepare("INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const updateStockStmt = db.prepare("UPDATE meals SET stock = stock - ? WHERE id = ?");

    const processPayment = db.transaction(() => {
      for (const cartItem of cart) {
        const mealData = cartItem.meal;
        const mealId = String((mealData && mealData.id) || cartItem.meal_id || "");
        const quantity = Number(cartItem.quantity || 1);
        const meal = getMeal.get(mealId);

        if (!meal) {
          throw new Error("One of the selected meals no longer exists");
        }

        if (Number(meal.stock || 0) < quantity) {
          throw new Error(`${meal.name} does not have enough stock`);
        }

        saleStmt.run(
          Math.random().toString(36).slice(2, 11),
          mealId,
          quantity,
          Number(meal.price || 0) * quantity,
          customer_name || "Guest",
          new Date().toISOString()
        );

        updateStockStmt.run(quantity, mealId);

        if (cartItem.pickupTime) {
          preorderStmt.run(
            Math.random().toString(36).slice(2, 11),
            customer_name || "Guest",
            mealId,
            quantity,
            cartItem.pickupTime,
            "Pending",
            new Date().toISOString()
          );
        }
      }
    });

    try {
      processPayment();
      res.json({
        success: true,
        status: "paid",
        promptMessage: "Payment request sent to your phone. Enter your MoMo PIN.",
      });
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : "Payment failed" });
    }
  });

  app.get("/api/preorders", (req, res) => {
    const preorders = db.prepare("SELECT * FROM preorders ORDER BY timestamp DESC").all();
    res.json(preorders);
  });

  app.post("/api/preorders", (req, res) => {
    const { id, customer_name, meal_id, quantity, pickup_time, status, timestamp } = req.body;
    const stmt = db.prepare("INSERT INTO preorders (id, customer_name, meal_id, quantity, pickup_time, status, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)");
    stmt.run(id, customer_name, meal_id, quantity, pickup_time, status, timestamp);
    res.json({ success: true });
  });

  app.patch("/api/preorders/:id", (req, res) => {
    const { status } = req.body;
    db.prepare("UPDATE preorders SET status = ? WHERE id = ?").run(status, req.params.id);
    res.json({ success: true });
  });

  app.get("/api/feedback", (req, res) => {
    const feedback = db.prepare("SELECT * FROM feedback ORDER BY timestamp DESC").all();
    res.json(feedback);
  });

  app.post("/api/feedback", (req, res) => {
    const { id, customer_name, meal_id, rating, comment, timestamp } = req.body;
    const stmt = db.prepare("INSERT INTO feedback (id, customer_name, meal_id, rating, comment, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(id, customer_name, meal_id, rating, comment, timestamp);
    res.json({ success: true });
  });

  app.get("/api/notifications", (req, res) => {
    const notifications = db.prepare("SELECT * FROM notifications ORDER BY timestamp DESC").all();
    res.json(notifications);
  });

  app.post("/api/notifications", (req, res) => {
    const { id, message, recipients_count, channel, timestamp } = req.body;
    const stmt = db.prepare("INSERT INTO notifications (id, message, recipients_count, channel, timestamp) VALUES (?, ?, ?, ?, ?)");
    stmt.run(id, message, recipients_count, channel, timestamp);
    res.json({ success: true });
  });

  app.post("/api/register", (req, res) => {
    const { name, email, password, role } = req.body || {};

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Name, email, password, and role are required." });
    }

    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Selected role is invalid." });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const trimmedName = String(name).trim();

    if (!trimmedName || !trimmedEmail || String(password).length < 6) {
      return res.status(400).json({ message: "Please provide valid details and a password with at least 6 characters." });
    }

    const existingUser = db.prepare("SELECT * FROM users WHERE email = ?").get(trimmedEmail);
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }

    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = {
      id: userId,
      name: trimmedName,
      email: trimmedEmail,
      role,
      password: hashPassword(String(password)),
    };

    db.prepare("INSERT INTO users (id, name, email, role, password) VALUES (?, ?, ?, ?, ?)").run(
      user.id,
      user.name,
      user.email,
      user.role,
      user.password
    );

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  app.post("/api/login", (req, res) => {
    const { email, password, role } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const trimmedEmail = String(email).trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(trimmedEmail);

    if (!user || !verifyPassword(String(password), user.password)) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (role && user.role !== role) {
      return res.status(401).json({ message: "This account is not allowed for the selected role." });
    }

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  });

  const serveBuiltApp = () => {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  };

  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (error) {
      const distIndex = path.resolve("dist/index.html");
      if (!fs.existsSync(distIndex)) {
        throw error;
      }

      console.warn("Vite dev server unavailable, serving built dist instead.");
      serveBuiltApp();
    }
  } else {
    serveBuiltApp();
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
