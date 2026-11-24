import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import { list, put } from "@vercel/blob";
import { DAILY_MEAL_DAYS, normalizeMealDays } from "../lib/mealAvailability.js";
import { databaseConnectionOptions } from "../lib/databaseConnection.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env.local") });
loadEnv({ path: path.join(root, ".env.migrate"), override: true });
if (process.env.BLOB_READ_WRITE_TOKEN) {
  delete process.env.BLOB_STORE_ID;
  delete process.env.BLOB_WEBHOOK_PUBLIC_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
}
const csvPath = path.resolve(root, process.env.PRODUCTS_CSV_PATH || "products.csv");
const uploadsDir = path.resolve(root, process.env.UPLOADS_DIR || "uploads");
const blobPrefix = "products-csv-import/";
const headers = [
  "id",
  "name",
  "category",
  "description",
  "price",
  "stock",
  "image_url",
  "available_start",
  "available_end",
];
const imageContentTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("The products CSV contains an unclosed quoted field.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

function parseProducts(csvText) {
  const [csvHeaders, ...csvRows] = parseCsv(csvText);
  if (!csvHeaders || headers.some((header) => !csvHeaders.includes(header))) {
    throw new Error("The products CSV is missing one or more required columns.");
  }

  const productsById = new Map();
  for (const [index, values] of csvRows.entries()) {
    if (values.length !== csvHeaders.length) {
      throw new Error(`CSV row ${index + 2} has an unexpected number of columns.`);
    }
    const row = Object.fromEntries(csvHeaders.map((header, i) => [header, values[i].trim()]));
    const product = {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description || "",
      price: Number(row.price),
      stock: Number(row.stock),
      image_url: row.image_url || null,
      available_start: row.available_start || null,
      available_end: row.available_end || null,
      available_days: row.available_days ? normalizeMealDays(row.available_days) : DAILY_MEAL_DAYS,
    };

    if (
      !product.id ||
      !product.name ||
      !product.category || !product.available_days ||
      !Number.isFinite(product.price) ||
      product.price < 0 ||
      !Number.isSafeInteger(product.stock) ||
      product.stock < 0
    ) {
      throw new Error(`CSV row ${index + 2} has invalid meal data.`);
    }

    const existing = productsById.get(product.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(product)) {
      throw new Error("The CSV contains conflicting rows for the same meal ID.");
    }
    productsById.set(product.id, product);
  }

  return [...productsById.values()];
}

async function validateLocalImages(products) {
  const filenames = new Set();
  for (const product of products) {
    if (!product.image_url?.startsWith("/uploads/")) continue;
    const filename = product.image_url.slice("/uploads/".length);
    if (!filename || path.basename(filename) !== filename || filename.includes("\\")) {
      throw new Error("The CSV contains an invalid local image path.");
    }
    const extension = path.extname(filename).toLowerCase();
    if (!imageContentTypes[extension]) {
      throw new Error(`Unsupported image format in CSV: ${extension || "(no extension)"}.`);
    }
    await fs.access(path.join(uploadsDir, filename));
    filenames.add(filename);
  }
  return filenames;
}

async function checkOnly() {
  const csvText = await fs.readFile(csvPath, "utf8");
  const products = parseProducts(csvText);
  const filenames = await validateLocalImages(products);
  console.log(`CSV rows validated and deduplicated to ${products.length} meals.`);
  console.log(`${filenames.size} referenced local images exist and are supported.`);
  console.log("No database writes or Blob uploads were performed.");
}

async function preflight() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing. Add the production PostgreSQL URL to .env.migrate.");
  }

  const csvText = await fs.readFile(csvPath, "utf8");
  const products = parseProducts(csvText);
  const filenames = await validateLocalImages(products);
  const pool = new pg.Pool({
    ...databaseConnectionOptions(process.env.DATABASE_URL),
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    const { rows } = await pool.query("SELECT to_regclass('meals') AS table_name");
    if (!rows[0].table_name) {
      console.log("Connected to PostgreSQL; the meals table does not exist yet.");
    } else {
      const { rows: conflicts } = await pool.query(
        "SELECT id FROM meals WHERE id = ANY($1::text[])",
        [products.map((product) => product.id)]
      );
      if (conflicts.length) {
        throw new Error(
          `${conflicts.length} meal ID(s) already exist in the database; no data was changed.`
        );
      }
      console.log("Connected to PostgreSQL; none of the meal IDs already exist.");
    }

    console.log(`Ready to import ${products.length} unique meals and ${filenames.size} local images.`);
    console.log("This preflight made no database writes or Blob uploads.");
  } finally {
    await pool.end();
  }
}

async function listExistingBlobs() {
  const blobsByPath = new Map();
  let cursor;
  do {
    const page = await list({ prefix: blobPrefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) blobsByPath.set(blob.pathname, blob.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobsByPath;
}

async function uploadLocalImages(products, filenames) {
  const blobsByPath = await listExistingBlobs();
  const imageUrls = new Map();

  for (const filename of filenames) {
    const blobPath = `${blobPrefix}${filename}`;
    let url = blobsByPath.get(blobPath);
    if (!url) {
      const extension = path.extname(filename).toLowerCase();
      const file = await fs.readFile(path.join(uploadsDir, filename));
      const blob = await put(blobPath, file, {
        access: "public",
        addRandomSuffix: false,
        contentType: imageContentTypes[extension],
      });
      url = blob.url;
    }
    imageUrls.set(`/uploads/${filename}`, url);
  }

  return products.map((product) => ({
    ...product,
    image_url: product.image_url ? imageUrls.get(product.image_url) || product.image_url : null,
  }));
}

async function migrate() {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (
    !process.env.BLOB_READ_WRITE_TOKEN &&
    !(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)
  ) {
    missing.push("Vercel Blob credentials");
  }
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}.`);
  }

  const csvText = await fs.readFile(csvPath, "utf8");
  const products = parseProducts(csvText);
  const filenames = await validateLocalImages(products);
  const pool = new pg.Pool({
    ...databaseConnectionOptions(process.env.DATABASE_URL),
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    await pool.query(`
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
      )
    `);
    await pool.query(`ALTER TABLE meals ADD COLUMN IF NOT EXISTS available_days TEXT NOT NULL DEFAULT '${DAILY_MEAL_DAYS}'`);

    const { rows: conflicts } = await pool.query(
      "SELECT id FROM meals WHERE id = ANY($1::text[])",
      [products.map((product) => product.id)]
    );
    if (conflicts.length) {
      throw new Error(
        `${conflicts.length} meal ID(s) already exist in the database; no meals were imported.`
      );
    }

    const productsWithBlobUrls = await uploadLocalImages(products, filenames);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const product of productsWithBlobUrls) {
        await client.query(
          `INSERT INTO meals
            (id, name, category, description, price, stock, image_url, available_start, available_end, available_days)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            product.id,
            product.name,
            product.category,
            product.description,
            product.price,
            product.stock,
            product.image_url,
            product.available_start,
            product.available_end,
            product.available_days,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log(`Imported ${productsWithBlobUrls.length} meals.`);
    console.log(`Migrated ${filenames.size} local images to public Blob URLs.`);
    console.log("Existing non-local image URLs were preserved.");
  } finally {
    await pool.end();
  }
}

const mode = process.argv[2];
if (mode === "--check") {
  await checkOnly();
} else if (mode === "--preflight") {
  await preflight();
} else if (mode === "--migrate") {
  await migrate();
} else {
  throw new Error("Choose --check, --preflight (read-only database check), or --migrate.");
}
