#!/usr/bin/env bash
# Restore a Mindstrate data volume from a tarball produced by backup.sh.
# This OVERWRITES the current volume contents. The script will refuse to
# proceed unless the team-server and web-ui containers are stopped, to
# guarantee SQLite consistency.
#
# Usage:
#   bash deploy/restore.sh ./backups/mindstrate-20260420-101500.tgz

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup.tgz>" >&2
  exit 1
fi
ARCHIVE=$(realpath "$1")
[ -f "$ARCHIVE" ] || { echo "File not found: $ARCHIVE" >&2; exit 1; }

for c in mindstrate-team-server mindstrate-web-ui; do
  if [ "$(docker container inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    echo "Container '$c' is still running. Stop the stack first:" >&2
    echo "  docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy stop" >&2
    exit 1
  fi
done

echo "About to wipe mindstrate-data and restore from:"
echo "  $ARCHIVE"
read -r -p "Type 'yes' to continue: " confirm
[ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }

# Recreate the volume empty, then untar into it.
docker volume rm mindstrate-data >/dev/null 2>&1 || true
docker volume create mindstrate-data >/dev/null

docker run --rm \
  -v mindstrate-data:/data \
  -v "$(dirname "$ARCHIVE")":/src:ro \
  alpine:3.20 \
  sh -c "cd /data && tar xzf /src/$(basename "$ARCHIVE")"

echo "Restore complete. Start the stack:"
echo "  docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d"
