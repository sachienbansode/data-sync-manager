import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function resolveKey(): string {
  const key = process.env.PII_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("PII_ENCRYPTION_KEY must be set as a 64-char hex string (32 bytes).");
  }
  return key;
}

export function encrypt(plaintext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? resolveKey(), "hex");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string, keyHex?: string): string {
  const key = Buffer.from(keyHex ?? resolveKey(), "hex");
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
