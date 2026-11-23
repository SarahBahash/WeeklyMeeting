#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh into an EMPTY database.
# Usage: TARGET_DATABASE_URL=... scripts/restore.sh backups/iahub-XXXX.dump
set -euo pipefail
FILE="$1"
URL="${TARGET_DATABASE_URL%%\?*}"
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$URL" "$FILE"
echo "Restore complete. Verify with: psql \"$URL\" -c 'select count(*) from action_points'"
