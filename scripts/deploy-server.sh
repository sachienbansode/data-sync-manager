#!/usr/bin/env bash
# deploy-server.sh — runs ON the AWS server after every GitHub Actions rsync
# Handles BOTH first-time setup AND subsequent deploys (fully idempotent)
# Called by GitHub Actions SSH step

set -e

APP_DIR="/home/ubuntu/ananta-platform"
ENV_FILE="$APP_DIR/.env.production"
LOG_DIR="/home/ubuntu/logs"

echo ""
echo "============================================"
echo "  Ananta Platform — Production Deploy"
echo "============================================"
cd "$APP_DIR"

# ── 1. Node.js 20 (skip if already installed) ───────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node --version)" != v20* ]]; then
  echo "[1/8] Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt-get install -y nodejs
else
  echo "[1/8] Node.js already installed: $(node --version)"
fi

# ── 2. pnpm ──────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  echo "[2/8] Installing pnpm..."
  sudo npm install -g pnpm@10 --silent
else
  echo "[2/8] pnpm already installed: $(pnpm --version)"
fi

# ── 3. PM2 ───────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "[3/8] Installing PM2..."
  sudo npm install -g pm2 --silent
else
  echo "[3/8] PM2 already installed: $(pm2 --version)"
fi

# ── 4. Nginx ─────────────────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
  echo "[4/8] Installing Nginx..."
  sudo apt-get update -q
  sudo apt-get install -y nginx
fi

# Stop Apache2 if running — it occupies port 80 and blocks Nginx
if sudo systemctl is-active --quiet apache2; then
  echo "[4/8] Stopping Apache2 (conflicts with Nginx on port 80)..."
  sudo systemctl stop apache2
  sudo systemctl disable apache2
fi

# Configure Nginx (idempotent — overwrite each deploy to pick up any changes)
echo "[4/8] Configuring Nginx..."
sudo cp "$APP_DIR/scripts/nginx.conf" /etc/nginx/sites-available/ananta-platform
sudo ln -sf /etc/nginx/sites-available/ananta-platform /etc/nginx/sites-enabled/ananta-platform
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
if sudo systemctl is-active --quiet nginx; then
  sudo systemctl reload nginx
else
  sudo systemctl enable nginx
  sudo systemctl start nginx
fi

# ── 5. Log directory & permissions ──────────────────────────────────────────
mkdir -p "$LOG_DIR"

# Allow Nginx (www-data) to read static files inside /home/ubuntu
sudo chmod o+x /home/ubuntu
sudo chmod -R o+rX "$APP_DIR/artifacts/web/dist"

# ── 6. Install dependencies ──────────────────────────────────────────────────
echo "[6/8] Installing Node dependencies..."
pnpm install --frozen-lockfile

# ── 7. .env.production (create template on first deploy, never overwrite) ────
if [ ! -f "$ENV_FILE" ]; then
  echo "[7/8] Creating .env.production template..."
  cat > "$ENV_FILE" << 'ENVTEMPLATE'
NODE_ENV=production
PORT=8080
CUSTOM_DATABASE_URL=postgresql://root_admin:YOUR_PASSWORD@13.233.106.37:5432/dev_ananta
JWT_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
REFRESH_TOKEN_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
SESSION_SECRET=REPLACE_WITH_64_CHAR_RANDOM_STRING
BASE_PATH=/
ENVTEMPLATE
  echo ""
  echo "  ⚠️  IMPORTANT: Edit $ENV_FILE with real secrets, then re-run the deploy."
  echo "  SSH in and run: nano $ENV_FILE"
  echo ""
else
  echo "[7/8] .env.production already exists — keeping existing secrets."
fi

# ── 8. Start / reload via PM2 ────────────────────────────────────────────────
echo "[8/8] Reloading application via PM2..."

# Source the .env file for PM2
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --env production
pm2 save
# Enable PM2 startup on reboot (first time only — idempotent)
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null | tail -1 | sudo bash 2>/dev/null || true

echo ""
echo "============================================"
echo "  Deploy complete!"
echo ""
pm2 status
echo ""
echo "  App:   http://13.233.106.37"
echo "  API:   http://13.233.106.37/api/health"
echo "============================================"
