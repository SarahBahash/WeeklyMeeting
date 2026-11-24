#!/usr/bin/env bash
# Runs once when the codespace is created: install dependencies and build.
set -euo pipefail
cd "$(dirname "$0")/.."
source .devcontainer/common.sh
echo "==> Installing dependencies…"
npm ci --no-audit --no-fund
echo "==> Building the application (APP_URL=$APP_URL)…"
npm run build
echo "==> Setup complete."
