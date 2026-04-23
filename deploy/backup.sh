#!/usr/bin/env bash
# Backup the Mindstrate data volume into a single tarball.
# Safe to run while the service is up — SQLite WAL mode tolerates a
# read snapshot. For absolute consistency you can stop team-server first.
#
# Usage:
#   bash deploy/backup.sh                              # writes ./backups/mindstrate-YYYYMMDD-HHMMSS.tgz
#   BACKUP_DIR=/srv/backups bash deploy/backup.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="${BACKUP_DIR}/mindstrate-${TS}.tgz"

mkdir -p "$BACKUP_DIR"

if ! docker volume inspect mindstrate-data >/dev/null 2>&1; then
  echo "Error: docker volume 'mindstrate-data' not found." >&2
  exit 1
fi

echo "Backing up volume mindstrate-data -> ${OUT}"
docker run --rm \
  -v mindstrate-data:/data:ro \
  -v "$(realpath "$BACKUP_DIR")":/backup \
  alpine:3.20 \
  tar czf "/backup/mindstrate-${TS}.tgz" -C /data .

size=$(du -h "$OUT" | cut -f1)
echo "Done. ${OUT} (${size})"
echo
echo "To restore:  bash deploy/restore.sh ${OUT}"
