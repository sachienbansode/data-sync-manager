#!/usr/bin/env bash
# deploy-server.sh — runs ON the AWS server after rsync
# Called by GitHub Actions SSH step

set -e

APP_DIR="/home/ubuntu/ananta-platform"
ENV_FILE="$APP_DIR/.env.production"

echo "=== Ananta Platform — Production Deploy ==="
cd "$APP_DIR"

# ── 1. Install/update runtime deps ──────────────────────────────────────────
echo "[1/5] Installing pnpm..."
npm install -g pnpm@10 --silent 2>/dev/null || true

echo "[2/5] Installing production dependencies..."
pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --frozen-lockfile

# ── 2. Check .env.production exists ─────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "WARNING: $ENV_FILE not found — creating template. Fill it in and redeploy."
  cat > "$ENV_FILE" << 'ENVTEMPLATE'
NODE_ENV=production
PORT=8080
CUSTOM_DATABASE_URL=postgresql://root_admin:PASSWORD@13.233.106.37:5432/dev_ananta
JWT_SECRET=CHANGE_ME_TO_STRONG_RANDOM_SECRET
REFRESH_TOKEN_SECRET=CHANGE_ME_TO_STRONG_RANDOM_SECRET
BASE_PATH=/
ENVTEMPLATE
fi

# ── 3. Install/update PM2 ────────────────────────────────────────────────────
echo "[3/5] Ensuring PM2 is installed..."
npm install -g pm2 --silent 2>/dev/null || true

# ── 4. Start / reload PM2 processes ─────────────────────────────────────────
echo "[4/5] Starting/reloading PM2 processes..."
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --env production

# ── 5. Save PM2 process list & enable startup ────────────────────────────────
echo "[5/5] Saving PM2 state..."
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

echo ""
echo "=== Deploy complete ==="
pm2 status
