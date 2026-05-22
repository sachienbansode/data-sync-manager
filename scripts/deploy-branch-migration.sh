#!/usr/bin/env bash
# =============================================================================
# deploy-branch-migration.sh
# =============================================================================
# Deploys the Branch Migration feature to the AWS server.
# Covers all changes made on 2026-05-22:
#
#   - New page:    /ops/branch-migration  (Admin-only in sidebar)
#   - RBAC:        "Branch Migration" added to Roles & Permissions list
#   - API routes:  GET|POST|PUT|DELETE /api/admin/branch-migration
#   - API routes:  GET /api/v1/branch-migration  (API-key auth)
#
# DB migration is managed separately — run scripts/migrations/20260522_branch_migration.sql
# manually via psql before or after this script.
#
# Usage (run ON the AWS server):
#   bash /home/ubuntu/ananta-platform/scripts/deploy-branch-migration.sh
#
# Or run remotely from your machine:
#   ssh ubuntu@13.233.106.37 \
#     "bash /home/ubuntu/ananta-platform/scripts/deploy-branch-migration.sh"
# =============================================================================

set -euo pipefail

APP_DIR="/home/ubuntu/ananta-platform"
ENV_FILE="$APP_DIR/.env.production"
LOG_FILE="/home/ubuntu/logs/deploy-branch-migration-$(date +%Y%m%d-%H%M%S).log"

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }
step() { echo ""; echo -e "${GREEN}▶ $*${NC}"; }

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================================"
echo "  Ananta Platform — Branch Migration Feature Deploy"
echo "  $(date)"
echo "============================================================"

# ── Pre-flight ──────────────────────────────────────────────────────────────
[ -d "$APP_DIR" ]  || fail "App directory not found: $APP_DIR"
[ -f "$ENV_FILE" ] || fail ".env.production not found: $ENV_FILE"

# Load env vars
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$APP_DIR"

# ── Step 1: Pull latest code ────────────────────────────────────────────────
step "1/4  Pulling latest code from origin/main"
git fetch origin main
git reset --hard origin/main
ok "Code updated to $(git rev-parse --short HEAD)"

# ── Step 2: Install / sync dependencies ────────────────────────────────────
step "2/4  Installing Node dependencies"
pnpm install --frozen-lockfile --silent
pnpm rebuild --silent
ok "Dependencies ready"

# ── Step 3: Build frontend ──────────────────────────────────────────────────
# PORT and BASE_PATH are needed by vite.config.ts; safe defaults used for builds.
step "3/4  Building frontend (React/Vite → artifacts/web/dist/public)"
PORT="${PORT:-3000}" BASE_PATH="${BASE_PATH:-/}" \
  pnpm --filter @workspace/web run build
ok "Frontend built — Nginx serves static files from artifacts/web/dist/public"

# ── Step 4: Build & restart API ─────────────────────────────────────────────
step "4/4  Building API server and restarting"
pnpm --filter @workspace/api-server run build
ok "API server built"

if pm2 list | grep -q "ananta-api"; then
    pm2 restart ananta-api --update-env
    ok "PM2 process 'ananta-api' restarted"
else
    warn "PM2 process 'ananta-api' not found — attempting startOrReload..."
    pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --env production --update-env
fi
pm2 save

# ── Health check ────────────────────────────────────────────────────────────
echo ""
step "Health check"
sleep 3
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:8080/api/health" 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    ok "API health check passed (HTTP $HTTP_STATUS)"
else
    warn "API returned HTTP $HTTP_STATUS — check logs: pm2 logs ananta-api --lines 30"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Deploy complete!"
echo ""
echo "  Commit : $(git rev-parse --short HEAD)"
echo "  Log    : $LOG_FILE"
echo ""
echo "  What was deployed:"
echo "    • Admin sidebar: Operations > Branch Migration"
echo "    • RBAC: Branch Migration added to Roles & Permissions"
echo "    • API routes: /api/admin/branch-migration (CRUD)"
echo "    • API routes: /api/v1/branch-migration (API-key auth)"
echo ""
echo "  NOTE: DB migration must be run separately:"
echo "    psql \$DB_URL -f scripts/migrations/20260522_branch_migration.sql"
echo ""
pm2 status
echo "============================================================"
