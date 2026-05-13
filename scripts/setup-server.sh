#!/usr/bin/env bash
# setup-server.sh — one-time setup on a fresh Ubuntu AWS instance
# Run once as: bash setup-server.sh
# After this, GitHub Actions handles all future deploys automatically.

set -e
echo "=== Ananta Platform — Server Setup ==="

# ── System deps ──────────────────────────────────────────────────────────────
echo "[1/7] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq curl git nginx

# ── Node.js 20 LTS via NodeSource ────────────────────────────────────────────
echo "[2/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -qq
sudo apt-get install -y -qq nodejs

echo "Node: $(node --version)  NPM: $(npm --version)"

# ── pnpm + PM2 ───────────────────────────────────────────────────────────────
echo "[3/7] Installing pnpm and PM2..."
sudo npm install -g pnpm@10 pm2 --silent

# ── Log directory ────────────────────────────────────────────────────────────
echo "[4/7] Creating log directory..."
mkdir -p /home/ubuntu/logs

# ── App directory ────────────────────────────────────────────────────────────
echo "[5/7] Creating app directory..."
mkdir -p /home/ubuntu/ananta-platform

# ── Nginx config ─────────────────────────────────────────────────────────────
echo "[6/7] Configuring Nginx..."
sudo cp /home/ubuntu/ananta-platform/scripts/nginx.conf /etc/nginx/sites-available/ananta-platform
sudo ln -sf /etc/nginx/sites-available/ananta-platform /etc/nginx/sites-enabled/ananta-platform
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
echo "Nginx configured."

# ── .env.production ──────────────────────────────────────────────────────────
echo "[7/7] Creating .env.production..."
ENV_FILE="/home/ubuntu/ananta-platform/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVTEMPLATE'
NODE_ENV=production
PORT=8080
CUSTOM_DATABASE_URL=postgresql://root_admin:YOUR_PASSWORD@13.233.106.37:5432/dev_ananta
JWT_SECRET=REPLACE_WITH_STRONG_RANDOM_64_CHAR_SECRET
REFRESH_TOKEN_SECRET=REPLACE_WITH_STRONG_RANDOM_64_CHAR_SECRET
BASE_PATH=/
ENVTEMPLATE
  echo "Created $ENV_FILE — IMPORTANT: edit it with your real secrets before deploying!"
else
  echo "$ENV_FILE already exists, skipping."
fi

# ── PM2 startup ─────────────────────────────────────────────────────────────
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash || true

echo ""
echo "=========================================="
echo "  Server setup complete!"
echo "  Next steps:"
echo "  1. Edit /home/ubuntu/ananta-platform/.env.production with real values"
echo "  2. Add the GitHub deploy public key to ~/.ssh/authorized_keys"
echo "  3. Push to main branch — GitHub Actions will deploy automatically"
echo "=========================================="
