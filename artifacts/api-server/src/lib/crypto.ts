import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _cachedKey: string | null = null;

export const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Load and validate PII_ENCRYPTION_KEY from environment.
 * Throws at startup if the key is missing or malformed — PII routes are
 * unavailable until a valid 64-hex-char key is configured as a Replit Secret.
 * Key material is never logged.
 *
 * Generate a key: openssl rand -hex 32
 */
export function loadEncryptionKey(): string {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.PII_ENCRYPTION_KEY;

  if (!envKey) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. " +
      "Generate one with: openssl rand -hex 32 " +
      "and add it as a Replit Secret before using PII routes."
    );
  }

  if (!HEX_64.test(envKey)) {
    throw new Error(
      "PII_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes for AES-256). " +
      "Generate a valid key with: openssl rand -hex 32"
    );
  }

  _cachedKey = envKey;
  return _cachedKey;
}

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

export function looksEncrypted(value: string): boolean {
  if (!value || value.length < 40) return false;
  try {
    const buf = Buffer.from(value, "base64");
    return buf.toString("base64") === value && buf.length >= IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}
