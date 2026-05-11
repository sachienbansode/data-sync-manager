#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Encrypt any plaintext PII fields (safe to re-run; skips already-encrypted values).
# Requires PII_ENCRYPTION_KEY to be set as a Replit Secret.
if [ -n "$PII_ENCRYPTION_KEY" ]; then
  pnpm --filter @workspace/db exec tsx src/migrate-pii-plaintext.ts
fi
