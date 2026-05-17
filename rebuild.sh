#!/usr/bin/env bash
# rebuild.sh — Rebuild ONLY (no git pull, no pnpm install)
# Safe: backs up and restores .env.production around the build
# Usage: ./rebuild.sh

set -e
APP_DIR="/home/ubuntu/ananta-platform"
ENV_FILE="$APP_DIR/.env.production"
ENV_BACKUP="$APP_DIR/.env.production.bak"

cd "$APP_DIR"

echo ""
echo "========================================"
echo "  Ananta Platform — Safe Rebuild"
echo "========================================"

# ── Guard: .env.production must exist ────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Aborting."
  exit 1
fi

# ── Backup .env.production before touching anything ──────────────────────────
cp "$ENV_FILE" "$ENV_BACKUP"
echo "  .env.production backed up → .env.production.bak"
echo "  MD5 before: $(md5sum "$ENV_FILE" | cut -d' ' -f1)"

# ── Build API server ──────────────────────────────────────────────────────────
echo ""
echo "[1/3] Building API server..."
pnpm --filter @workspace/api-server run build
echo "  Done."

# ── Build frontend ────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Building frontend..."
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/web run build
echo "  Done."

# ── Restore .env.production (in case anything changed it) ────────────────────
cp "$ENV_BACKUP" "$ENV_FILE"
echo ""
echo "  .env.production restored from backup."
echo "  MD5 after:  $(md5sum "$ENV_FILE" | cut -d' ' -f1)"

# ── Restart app ───────────────────────────────────────────────────────────────
echo ""
echo "[3/3] Restarting application..."
pm2 restart 0
echo "  Done."

echo ""
echo "========================================"
echo "  Rebuild complete!"
echo "========================================"
