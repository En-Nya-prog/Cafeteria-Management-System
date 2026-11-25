const sslParameters = ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "sslcrl", "uselibpqcompat"];
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function databaseConnectionOptions(connectionString, { requireTls = false, ca = process.env.DATABASE_CA_CERT } = {}) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Expected a PostgreSQL connection URL.");
  if (!requireTls && localHosts.has(url.hostname)) return { connectionString };

  // node-postgres URL SSL options can override the explicit SSL settings.
  for (const parameter of sslParameters) url.searchParams.delete(parameter);
  return {
    connectionString: url.href,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca: ca.replaceAll("\\n", "\n") } : {}) },
  };
}
