#!/usr/bin/env bash
# deploy.sh — Run this on your AWS server after every git pull
# Usage: ./deploy.sh
#
# Handles: git pull, pnpm install, frontend + API build, pm2 restart

set -e
APP_DIR="/home/ubuntu/ananta-platform"
cd "$APP_DIR"

echo ""
echo "========================================"
echo "  Ananta Platform — Deploy"
echo "========================================"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo ""
echo "[1/5] Pulling latest code from GitHub..."
git fetch origin
git reset --hard origin/main
echo "  Done."

# ── 2. Node dependencies ──────────────────────────────────────────────────────
echo ""
echo "[2/5] Installing Node dependencies..."
pnpm install --frozen-lockfile
echo "  Done."

# ── 3. Build API server ───────────────────────────────────────────────────────
echo ""
echo "[3/5] Building API server..."
pnpm --filter @workspace/api-server run build
echo "  Done."

# ── 4. Build frontend ─────────────────────────────────────────────────────────
echo ""
echo "[4/5] Building frontend..."
# PORT and BASE_PATH are only needed by the vite dev server,
# not the build output — passing dummy values so vite.config.ts doesn't abort.
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/web run build
echo "  Done."

# ── 5. Restart app ────────────────────────────────────────────────────────────
echo ""
echo "[5/5] Restarting application..."
pm2 restart 0
echo "  Done."

echo ""
echo "========================================"
echo "  Deploy complete!"
echo "  App:  http://$(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_IP')"
echo "  Logs: pm2 logs ananta-api"
echo "========================================"
