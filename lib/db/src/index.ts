import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import * as schema from "./schema";

const { Pool } = pg;

// Load .env.production before reading env vars so the app is self-sufficient
// regardless of how PM2 or the shell passes environment variables.
// Only sets vars that are not already present (existing env always wins).
function loadEnvFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx < 1) continue;
      const key = line.slice(0, idx).trim();
      let val = line.slice(idx + 1).trim();
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
    // silently skip unreadable files
  }
}

// Try common locations for .env.production
const envCandidates = [
  path.resolve(process.cwd(), ".env.production"),
  path.resolve(process.cwd(), "../.env.production"),
  "/home/ubuntu/ananta-platform/.env.production",
];
for (const f of envCandidates) {
  loadEnvFile(f);
}

const connectionString = process.env.DATABASE_URL || process.env.CUSTOM_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.production at the project root."
  );
}

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });

export * from "./schema";
