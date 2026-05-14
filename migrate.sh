#!/bin/bash
set -e

ENV_FILE="$(dirname "$0")/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env.production not found at $ENV_FILE"
  echo "Run: cp .env.production.example .env.production  and fill in your values."
  exit 1
fi

echo "Loading $ENV_FILE ..."
set -o allexport
source "$ENV_FILE"
set +o allexport

echo ""
echo "==> Running DB schema push..."
pnpm --filter @workspace/db run push

echo ""
echo "==> Running seed (roles + page permissions)..."
pnpm --filter @workspace/scripts run seed

echo ""
echo "Done."
