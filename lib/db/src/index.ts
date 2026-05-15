import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

const { Pool } = pg;

/**
 * Parse a .env file and inject missing vars into process.env.
 * Only sets vars that are not already present — shell/PM2 env always wins.
 * Handles CRLF line endings, quoted values, and `=` signs inside values.
 */
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // Non-fatal — fall through to env-var check below
  }
}

// Search for .env.production walking up from this file's location.
// Covers: monorepo root, server root, cwd — whichever comes first.
const candidates = [
  path.resolve(__dirname, "../../../.env.production"),   // monorepo root
  path.resolve(__dirname, "../../.env.production"),
  path.resolve(process.cwd(), ".env.production"),
];
for (const f of candidates) {
  loadEnvFile(f);
}

// In Replit (REPL_ID always set) prefer the built-in Postgres secret.
// On any other host (AWS etc.) DATABASE_URL is authoritative.
const isReplit = !!process.env.REPL_ID;

const connectionString = isReplit
  ? (process.env.CUSTOM_DATABASE_URL || process.env.DATABASE_URL)
  : (process.env.DATABASE_URL || process.env.CUSTOM_DATABASE_URL);

if (!connectionString) {
  throw new Error(
    isReplit
      ? "CUSTOM_DATABASE_URL secret is not set in Replit. Add it in the Secrets panel."
      : "DATABASE_URL is not set. Add it to /home/ubuntu/ananta-platform/.env.production"
  );
}

export const pool = new Pool({
  connectionString,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  idleTimeoutMillis: 20_000,
  connectionTimeoutMillis: 5_000,
  max: 10,
});

pool.on("error", (err) => {
  console.error("[pg-pool] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
