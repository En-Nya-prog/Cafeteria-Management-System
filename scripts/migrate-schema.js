import "dotenv/config";
import pg from "pg";
import { applyDatabaseSchema } from "../lib/databaseSchema.js";
import { databaseConnectionOptions } from "../lib/databaseConnection.js";

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) throw new Error("Set DATABASE_MIGRATION_URL to the PostgreSQL schema-owner URL.");
const runtimeRole = process.env.DATABASE_RUNTIME_ROLE;
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const runtimeTables = [
  "meals", "users", "sessions", "staff_mfa", "sales", "preorders", "feedback", "notifications",
  "user_notifications", "rate_limits", "payments", "payment_items", "seller_order_notification_deliveries",
  "order_assignments",
];

const client = new pg.Client(databaseConnectionOptions(connectionString));
await client.connect();
try {
  await client.query("BEGIN");
  await applyDatabaseSchema({ exec: (sql) => client.query(sql) });
  if (runtimeRole) {
    const { rows: [role] } = await client.query(`
      SELECT current_schema() AS schema_name, rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls,
        pg_has_role(rolname, current_user, 'MEMBER') AS inherits_owner,
        has_schema_privilege(rolname, current_schema(), 'CREATE') AS can_create
      FROM pg_roles WHERE rolname = $1 AND rolcanlogin
    `, [runtimeRole]);
    if (!role || role.rolsuper || role.rolcreaterole || role.rolcreatedb || role.rolbypassrls ||
        role.inherits_owner || role.can_create) {
      throw new Error("DATABASE_RUNTIME_ROLE must be a separate login without elevated or schema-create privileges.");
    }
    const schema = quote(role.schema_name);
    const account = quote(runtimeRole);
    const tables = runtimeTables.map(table => `${schema}.${quote(table)}`).join(", ");
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${account}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tables} TO ${account}`);
    for (const [table, column] of [["meals", "item_code"], ["payment_items", "id"]]) {
      const { rows: [result] } = await client.query(
        "SELECT pg_get_serial_sequence($1, $2) AS sequence_name", [`${schema}.${quote(table)}`, column],
      );
      if (result.sequence_name) await client.query(`GRANT USAGE ON SEQUENCE ${result.sequence_name} TO ${account}`);
    }
    await client.query(`REVOKE ALL ON ${schema}.security_audit FROM ${account}`);
    await client.query(`GRANT SELECT ON ${schema}.cafeteria_audit_log TO ${account}`);
  }
  await client.query("COMMIT");
  console.log("Cafeteria database schema is up to date.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
