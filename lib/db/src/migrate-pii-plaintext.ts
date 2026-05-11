/**
 * PII Plaintext-to-Ciphertext Migration Utility
 *
 * Run this script after setting PII_ENCRYPTION_KEY to encrypt any plaintext
 * values that were inserted into pii_records before encryption was enforced.
 *
 * Safe to run multiple times — already-encrypted values are detected and skipped.
 *
 * Usage:
 *   PII_ENCRYPTION_KEY=<64-char hex> pnpm --filter @workspace/db exec tsx src/migrate-pii-plaintext.ts
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { db, piiRecordsTable } from "./index";
import { eq } from "drizzle-orm";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function encryptField(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Returns true if the value looks like AES-256-GCM ciphertext.
 * Minimum encoded length = IV(12) + AuthTag(16) + 1 data byte = 29 bytes → base64 ≥ 40 chars.
 */
function looksEncrypted(value: string): boolean {
  if (!value || value.length < 40) return false;
  try {
    const buf = Buffer.from(value, "base64");
    return buf.toString("base64") === value && buf.length >= IV_LEN + TAG_LEN + 1;
  } catch {
    return false;
  }
}

const PII_FIELDS = [
  "phone", "nationalId", "bankAccount", "panNumber", "emailCounterparty", "address",
] as const;

async function main() {
  const keyHex = process.env.PII_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyHex)) {
    console.error("ERROR: PII_ENCRYPTION_KEY must be a 64-char hex string.");
    process.exit(1);
  }

  const records = await db.select().from(piiRecordsTable);
  console.log(`Found ${records.length} PII record(s). Scanning for plaintext values…`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const record of records) {
    const updates: Partial<typeof piiRecordsTable.$inferInsert> = {};
    let hasPlaintext = false;

    for (const field of PII_FIELDS) {
      const value = record[field as keyof typeof record] as string | null;
      if (!value) continue;

      if (looksEncrypted(value)) {
        totalSkipped++;
        continue;
      }

      console.log(`  Record ${record.id}: encrypting field '${field}' (plaintext detected)`);
      (updates as Record<string, string>)[field] = encryptField(value, keyHex);
      hasPlaintext = true;
    }

    if (hasPlaintext) {
      await db.update(piiRecordsTable).set(updates).where(eq(piiRecordsTable.id, record.id));
      totalUpdated++;
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  ${totalUpdated} record(s) updated (plaintext fields encrypted)`);
  console.log(`  ${totalSkipped} field(s) skipped (already encrypted)`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
