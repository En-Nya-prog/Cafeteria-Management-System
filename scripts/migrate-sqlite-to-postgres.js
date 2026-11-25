import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import path from "node:path";
import { databaseConnectionOptions } from "../lib/databaseConnection.js";

const sourcePath = process.env.SQLITE_SOURCE_PATH;
const connectionString = process.env.DATABASE_URL;

if (!sourcePath || !connectionString) {
  throw new Error("Set SQLITE_SOURCE_PATH and DATABASE_URL before running this migration.");
}

const migrationTables = [
  {
    name: "users",
    columns: ["id", "name", "email", "role", "password"],
  },
  {
    name: "meals",
    columns: [
      "id", "name", "category", "description", "price", "stock", "image_url",
      "available_start", "available_end",
    ],
  },
  {
    name: "sales",
    columns: ["id", "meal_id", "quantity", "total_price", "customer_name", "timestamp", "user_id"],
  },
  {
    name: "preorders",
    columns: [
      "id", "customer_name", "meal_id", "quantity", "pickup_time", "status", "timestamp", "user_id",
    ],
  },
  {
    name: "feedback",
    columns: ["id", "customer_name", "meal_id", "rating", "comment", "timestamp", "user_id"],
  },
  {
    name: "notifications",
    columns: ["id", "message", "recipients_count", "channel", "timestamp"],
  },
];

const sqlitePath = path.resolve(sourcePath);
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool(databaseConnectionOptions(connectionString));

try {
  const client = await pool.connect();
  const summary = [];
  try {
    await client.query("BEGIN");
    for (const table of migrationTables) {
      const sourceColumns = new Set(
        sqlite.prepare(`PRAGMA table_info(${table.name})`).all().map((column) => column.name)
      );
      if (sourceColumns.size === 0) continue;

      const targetColumns = table.columns.filter((column) =>
        sourceColumns.has(column) || column === "user_id"
      );
      const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all();
      const placeholders = targetColumns.map((_, index) => `$${index + 1}`).join(", ");
      const columnsSql = targetColumns.map((column) => `"${column}"`).join(", ");
      const insert = `INSERT INTO "${table.name}" (${columnsSql}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
      let imported = 0;

      for (const row of rows) {
        const values = targetColumns.map((column) => {
          if (column === "user_id" && !sourceColumns.has(column)) return null;
          if (table.name === "users" && column === "email" && typeof row[column] === "string") {
            return row[column].trim().toLowerCase();
          }
          return row[column] ?? null;
        });
        imported += (await client.query(insert, values)).rowCount;
      }

      summary.push({ table: table.name, source: rows.length, imported, skipped: rows.length - imported });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const result of summary) {
    console.log(`${result.table}: imported ${result.imported}/${result.source}; skipped ${result.skipped}`);
  }
  console.log("SQLite import committed. Reconcile these counts and verify image files before cutover.");
} finally {
  sqlite.close();
  await pool.end();
}
