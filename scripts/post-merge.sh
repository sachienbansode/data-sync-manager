#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Re-install Python pipeline dependencies into the virtualenv after every pull
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="$APP_DIR/venv"
REQUIREMENTS="$APP_DIR/artifacts/api-server/src/lib/requirements.txt"
if [ -f "$REQUIREMENTS" ]; then
  echo "Installing Python pipeline dependencies..."
  if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
  fi
  "$VENV_DIR/bin/pip" install --quiet -r "$REQUIREMENTS" && echo "  Python packages OK."
fi

pnpm --filter db push
# Encrypt any plaintext PII fields (safe to re-run; skips already-encrypted values).
# Requires PII_ENCRYPTION_KEY to be set as a Replit Secret.
if [ -n "$PII_ENCRYPTION_KEY" ]; then
  pnpm --filter @workspace/db exec tsx src/migrate-pii-plaintext.ts
fi
