#!/usr/bin/env bash
# run.sh — Loaded by PM2 as the app entry point.
# Sources .env.production so all vars are available to the Node process.
set -a
source "$(dirname "$0")/.env.production"
set +a
exec node --enable-source-maps "$(dirname "$0")/artifacts/api-server/dist/index.mjs"
