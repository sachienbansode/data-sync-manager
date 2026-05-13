import { defineConfig } from "drizzle-kit";
import path from "path";

const url = process.env.CUSTOM_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL or CUSTOM_DATABASE_URL must be set");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
