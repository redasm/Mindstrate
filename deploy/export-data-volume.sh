#!/usr/bin/env bash
# Export the Mindstrate data volume into a single tarball.
# Safe to run while the service is up — SQLite WAL mode tolerates a
# read snapshot. For absolute consistency you can stop team-server first.
#
# Usage:
#   bash deploy/export-data-volume.sh                              # writes ./data-exports/mindstrate-YYYYMMDD-HHMMSS.tgz
#   EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh

set -euo pipefail

EXPORT_DIR="${EXPORT_DIR:-./data-exports}"
TS=$(date +%Y%m%d-%H%M%S)
OUT="${EXPORT_DIR}/mindstrate-${TS}.tgz"

mkdir -p "$EXPORT_DIR"

if ! docker volume inspect mindstrate-data >/dev/null 2>&1; then
  echo "Error: docker volume 'mindstrate-data' not found." >&2
  exit 1
fi

echo "Exporting volume mindstrate-data -> ${OUT}"
docker run --rm \
  -v mindstrate-data:/data:ro \
  -v "$(realpath "$EXPORT_DIR")":/export \
  alpine:3.20 \
  tar czf "/export/mindstrate-${TS}.tgz" -C /data .

size=$(du -h "$OUT" | cut -f1)
echo "Done. ${OUT} (${size})"
echo
echo "To restore:  bash deploy/restore.sh ${OUT}"
