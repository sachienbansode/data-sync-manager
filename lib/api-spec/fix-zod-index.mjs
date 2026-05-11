/**
 * Post-codegen patch for lib/api-zod/src/index.ts.
 *
 * Orval (split + zod + schemas) generates an index.ts that:
 *   1. References "./generated/api.schemas" which is never produced → build error.
 *   2. Uses `export *` for both zod schemas (values) and TypeScript types of the
 *      same names → TS2308 duplicate-export ambiguity error.
 *
 * This script rewrites the file to:
 *   - Keep `export * from "./generated/api"` (zod schema values)
 *   - Convert `export * from "./generated/types"` → `export type *` (type-only)
 *   - Drop the non-existent `./generated/api.schemas` line entirely
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../api-zod/src/index.ts");

let content = readFileSync(indexPath, "utf8");

// Remove the missing api.schemas export
content = content.replace(/^export \* from "\.\/generated\/api\.schemas";\n?/m, "");

// Downgrade the types re-export to type-only so value names don't conflict
content = content.replace(
  /^export \* from "\.\/generated\/types";/m,
  'export type * from "./generated/types";'
);

writeFileSync(indexPath, content, "utf8");
console.log("✅ Patched lib/api-zod/src/index.ts");
