import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// In the Replit environment (REPL_ID is always set by the platform), prefer
// CUSTOM_DATABASE_URL (Replit's built-in Postgres) over DATABASE_URL, because
// DATABASE_URL may point to a remote AWS server that isn't reachable from
// Replit's network. On production (AWS / any non-Replit host), DATABASE_URL
// is authoritative.
const isReplit = !!process.env.REPL_ID;

const connectionString = isReplit
  ? (process.env.CUSTOM_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DATABASE_URL || process.env.CUSTOM_DATABASE_URL);

if (!connectionString) {
  throw new Error(
    isReplit
      ? "CUSTOM_DATABASE_URL secret is not set in Replit. Add it in the Secrets panel."
      : "DATABASE_URL must be set in .env.production on the server."
  );
}

export const pool = new Pool({
  connectionString,
  // Keep TCP connections alive so the server doesn't silently drop idle ones
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  // Evict idle connections from the pool before the server closes them
  idleTimeoutMillis: 20_000,
  // Fail fast on connection establishment rather than hanging
  connectionTimeoutMillis: 5_000,
  // Reasonable pool ceiling
  max: 10,
});

// Swallow connection errors that fire between queries (e.g. ECONNRESET on an
// idle socket) — the pool will automatically replace the dead connection.
pool.on("error", (err) => {
  console.error("[pg-pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
