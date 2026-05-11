import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

let _cachedKey: string | null = null;
let _ephemeralWarned = false;

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function loadEncryptionKey(): string {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.PII_ENCRYPTION_KEY;

  if (envKey) {
    if (!HEX_64.test(envKey)) {
      throw new Error(
        "PII_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256)."
      );
    }
    _cachedKey = envKey;
    return _cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "PII_ENCRYPTION_KEY is required in production. Set it as a Replit Secret."
    );
  }

  if (!_ephemeralWarned) {
    const ephemeral = randomBytes(32).toString("hex");
    _cachedKey = ephemeral;
    console.warn(
      `\n⚠  PII_ENCRYPTION_KEY not set — using ephemeral key for this session only.\n` +
      `   Data CANNOT be decrypted after restart. Set as Replit Secret:\n` +
      `   PII_ENCRYPTION_KEY = ${ephemeral}\n`
    );
    _ephemeralWarned = true;
  }

  return _cachedKey!;
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
