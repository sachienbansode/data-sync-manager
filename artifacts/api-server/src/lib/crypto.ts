import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { db, appSettingsTable } from "@workspace/db";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// In-memory cache for the active encryption key (avoids DB round-trip per encrypt/decrypt)
let _cachedKey: string | null = null;

/**
 * Load the PII encryption key from app_settings (DB-stored).
 * Falls back to PII_ENCRYPTION_KEY env var if DB has no key yet.
 * Key must be a 64-char hex string (32 bytes = AES-256).
 */
export async function loadEncryptionKey(): Promise<string> {
  if (_cachedKey) return _cachedKey;

  const [settings] = await db.select({ piiEncryptionKey: appSettingsTable.piiEncryptionKey })
    .from(appSettingsTable).limit(1);

  const key = settings?.piiEncryptionKey ?? process.env.PII_ENCRYPTION_KEY ?? null;

  if (!key || key.length !== 64) {
    throw new Error(
      "PII encryption key not configured. Set it via Admin → App Settings or provide PII_ENCRYPTION_KEY env var."
    );
  }

  _cachedKey = key;
  return key;
}

/**
 * Update the in-memory cached key. Called after rotation so decryption
 * works immediately without a server restart.
 */
export function updateCachedKey(newKey: string): void {
  _cachedKey = newKey;
}

export function encrypt(plaintext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? (_cachedKey ?? (() => { throw new Error("Key not loaded — call loadEncryptionKey() first"); })()), "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? (_cachedKey ?? (() => { throw new Error("Key not loaded — call loadEncryptionKey() first"); })()), "hex");
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
