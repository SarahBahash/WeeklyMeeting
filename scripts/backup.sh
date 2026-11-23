#!/usr/bin/env bash
# Logical backup of the IA Weekly Meeting Hub database (custom format, compressed).
# Usage: DATABASE_URL=... scripts/backup.sh [output-dir]
# Store backups in the organisation's approved, encrypted backup location.
set -euo pipefail
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
URL="${DATABASE_URL%%\?*}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/iahub-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$URL"
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup written: $FILE"
