#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Re-install Python pipeline dependencies after every pull
REQUIREMENTS="$(dirname "$0")/../artifacts/api-server/src/lib/requirements.txt"
if [ -f "$REQUIREMENTS" ]; then
  echo "Installing Python pipeline dependencies..."
  pip3 install -r "$REQUIREMENTS" --quiet && echo "  Python packages OK."
fi

pnpm --filter db push
# Encrypt any plaintext PII fields (safe to re-run; skips already-encrypted values).
# Requires PII_ENCRYPTION_KEY to be set as a Replit Secret.
if [ -n "$PII_ENCRYPTION_KEY" ]; then
  pnpm --filter @workspace/db exec tsx src/migrate-pii-plaintext.ts
fi
