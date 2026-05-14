import { defineConfig } from "drizzle-kit";
import path from "path";

const url = process.env.DATABASE_URL || process.env.CUSTOM_DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL must be set in .env.production (or CUSTOM_DATABASE_URL in Replit)");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
