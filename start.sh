#!/usr/bin/env bash
# start.sh — Reliably start/restart the Ananta Platform API with PM2
#
# Usage (from /home/ubuntu/ananta-platform):
#   chmod +x start.sh
#   ./start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Create it from .env.production.example first."
  exit 1
fi

echo "Loading environment from $ENV_FILE ..."
set -o allexport
# shellcheck source=/dev/null
source "$ENV_FILE"
set +o allexport

echo "Restarting PM2 process ..."
pm2 delete ananta-api 2>/dev/null || true
pm2 start "$SCRIPT_DIR/ecosystem.config.cjs"
pm2 save

echo ""
echo "Done. Verifying loaded environment:"
pm2 env 0 | grep -E "DATABASE_URL|JWT_SECRET|PII_ENCRYPTION_KEY|NODE_ENV|PORT" || true
echo ""
echo "Check logs with: pm2 logs ananta-api"
