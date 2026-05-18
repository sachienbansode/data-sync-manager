"""
AES-256-GCM decryption matching the Node.js crypto.ts implementation.

Node format (base64-encoded):
  [IV: 12 bytes][AuthTag: 16 bytes][Ciphertext: N bytes]

Python's cryptography AESGCM.decrypt expects: nonce, ciphertext+tag, aad
"""
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_LEN = 12
TAG_LEN = 16


def get_key() -> bytes:
    key_hex = os.environ.get("PII_ENCRYPTION_KEY", "")
    if not key_hex or len(key_hex) != 64:
        raise RuntimeError("PII_ENCRYPTION_KEY must be a 64-hex-char string")
    return bytes.fromhex(key_hex)


def decrypt(ciphertext_b64: str, key_hex: str | None = None) -> str:
    if not ciphertext_b64:
        return ""
    key = bytes.fromhex(key_hex) if key_hex else get_key()
    raw = base64.b64decode(ciphertext_b64)
    iv = raw[:IV_LEN]
    tag = raw[IV_LEN : IV_LEN + TAG_LEN]
    ciphertext = raw[IV_LEN + TAG_LEN :]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
    return plaintext.decode("utf-8")
