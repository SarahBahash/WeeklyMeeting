#!/usr/bin/env bash
# Runs every time the codespace is opened: start the demo (once) on port 3000.
set -euo pipefail
cd "$(dirname "$0")/.."
source .devcontainer/common.sh
if (echo > /dev/tcp/127.0.0.1/3000) >/dev/null 2>&1; then
  echo "IA Weekly Meeting Hub is already running – open the PORTS tab, port 3000."
  exit 0
fi
echo "==> Waiting for the database…"
for _ in $(seq 1 60); do
  (echo > /dev/tcp/db/5432) >/dev/null 2>&1 && break
  sleep 2
done
cat <<MSG

==================================================================
 IA Weekly Meeting Hub – DEMO (synthetic data only)
 Opening at: $APP_URL
 Sign in:    admin@example.test  /  Demo-Synthetic-2026!
 Other roles: organizer@ / editor@ / viewer@example.test (same password)
 Keep this terminal open while you use the demo.
==================================================================

MSG
exec npm run start:demo
