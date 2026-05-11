import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * In-memory active key cache.
 * Sourced ONLY from process.env.PII_ENCRYPTION_KEY (env/secret injection).
 * The key is NEVER persisted to the database — keeping the trust boundary
 * between ciphertext (DB) and key (environment) intact.
 *
 * On rotation: updateCachedKey() is called after re-encryption so decryption
 * works immediately for the current process. Admin must then update the
 * PII_ENCRYPTION_KEY environment secret before the next restart.
 */
let _cachedKey: string | null = null;
let _ephemeralWarned = false;

/**
 * Load the active encryption key from process.env.PII_ENCRYPTION_KEY.
 * If unset (dev/test only), generates an ephemeral key and warns loudly.
 * Throws in production if key is missing.
 */
export function loadEncryptionKey(): string {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.PII_ENCRYPTION_KEY;

  if (envKey) {
    if (envKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(envKey)) {
      throw new Error(
        "PII_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    _cachedKey = envKey;
    return _cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PII_ENCRYPTION_KEY environment variable is required in production. " +
      "Set it as a Replit secret or inject it via your secrets manager."
    );
  }

  // Development fallback: ephemeral in-memory key (data will not survive restarts)
  if (!_ephemeralWarned) {
    const ephemeral = randomBytes(32).toString("hex");
    _cachedKey = ephemeral;
    console.warn(
      "\n⚠️  PII_ENCRYPTION_KEY is not set. Using an ephemeral key for this session only.\n" +
      "   Encrypted data CANNOT be decrypted after a server restart.\n" +
      "   Set PII_ENCRYPTION_KEY as a Replit Secret to persist encrypted data:\n" +
      `   Value to set: ${ephemeral}\n` +
      "   (Admin → Secrets → PII_ENCRYPTION_KEY)\n"
    );
    _ephemeralWarned = true;
  }

  return _cachedKey!;
}

/**
 * Update the in-memory cached key after a rotation.
 * The new key is NOT persisted — admin must update PII_ENCRYPTION_KEY
 * environment secret before the next server restart.
 */
export function updateCachedKey(newKey: string): void {
  _cachedKey = newKey;
}

export function getCachedKey(): string | null {
  return _cachedKey;
}

export function encrypt(plaintext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? loadEncryptionKey(), "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? loadEncryptionKey(), "hex");
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Returns true if the value looks like AES-256-GCM ciphertext produced by encrypt().
 * Used by the migration utility to skip already-encrypted values.
 * Minimum encoded length = IV(12) + AuthTag(16) + 1 byte data = 29 bytes → base64 = 40 chars.
 */
export function looksEncrypted(value: string): boolean {
  if (!value || value.length < 40) return false;
  try {
    const buf = Buffer.from(value, "base64");
    // Re-encoding should yield the same string (valid base64)
    return buf.toString("base64") === value && buf.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
