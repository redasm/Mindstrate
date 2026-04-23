#!/usr/bin/env bash
# Pre-deployment safety check for Mindstrate.
# Run this on the SERVER before `docker compose up`. It only inspects;
# it never starts, stops, or modifies any running container.
#
# Usage:
#   bash deploy/preflight.sh
#   TEAM_PORT=4388 WEB_UI_PORT=4377 bash deploy/preflight.sh   # custom ports

set -u
TEAM_PORT="${TEAM_PORT:-3388}"
WEB_UI_PORT="${WEB_UI_PORT:-3377}"

ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED=1; }
section(){ printf '\n\033[1m%s\033[0m\n' "$*"; }

FAILED=0

# ---------- 1. Docker daemon ----------
section "1) Docker daemon"
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not installed"; exit 1
fi
if docker info >/dev/null 2>&1; then
  ok "docker is running ($(docker version --format '{{.Server.Version}}'))"
else
  fail "cannot talk to docker (need sudo? or daemon down?)"; exit 1
fi
if docker compose version >/dev/null 2>&1; then
  ok "docker compose v2 available ($(docker compose version --short))"
else
  fail "docker compose v2 not found (try: apt install docker-compose-plugin)"
fi

# ---------- 2. Existing containers (only listed, never touched) ----------
section "2) Existing containers on this host (will NOT be touched)"
running=$(docker ps --format '{{.Names}} -> {{.Image}}  ports:{{.Ports}}')
if [ -z "$running" ]; then
  ok "no running containers (clean host)"
else
  echo "$running" | sed 's/^/    /'
fi
if docker ps --format '{{.Names}}' | grep -E '^mindstrate-(team-server|web-ui)$' >/dev/null; then
  warn "Mindstrate containers already exist — re-running compose will recreate them safely."
fi

# ---------- 3. Port conflicts ----------
section "3) Port conflicts (need ${TEAM_PORT} and ${WEB_UI_PORT} free on host)"
check_port() {
  local p="$1"; local label="$2"
  # Try ss first, fall back to netstat, then lsof.
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnH "( sport = :${p} )" 2>/dev/null | grep -q .; then
      fail "port ${p} (${label}) is already in use:"
      ss -tlnp "( sport = :${p} )" 2>/dev/null | sed 's/^/      /'
      return
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | awk '{print $4}' | grep -E ":${p}\$" >/dev/null; then
      fail "port ${p} (${label}) is already in use:"
      netstat -tlnp 2>/dev/null | grep ":${p} " | sed 's/^/      /'
      return
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk '{print $9}' | grep -E ":${p}\$" >/dev/null; then
      fail "port ${p} (${label}) is already in use:"
      lsof -iTCP:${p} -sTCP:LISTEN -P -n 2>/dev/null | sed 's/^/      /'
      return
    fi
  else
    warn "no ss/netstat/lsof — cannot verify port ${p}"
    return
  fi
  ok "port ${p} (${label}) is free"
}
check_port "$TEAM_PORT" "Team Server"
check_port "$WEB_UI_PORT" "Web UI"

# Also check that no other compose project is using the names/volume.
section "4) Resource name collisions"
for name in mindstrate-team-server mindstrate-web-ui; do
  if docker container inspect "$name" >/dev/null 2>&1; then
    warn "container '${name}' exists (compose will recreate it)"
  else
    ok "container name '${name}' is free"
  fi
done
if docker network inspect mindstrate-net >/dev/null 2>&1; then
  warn "network 'mindstrate-net' exists (compose will reuse it)"
else
  ok "network name 'mindstrate-net' is free"
fi
if docker volume inspect mindstrate-data >/dev/null 2>&1; then
  warn "volume 'mindstrate-data' exists (your previous data will be reused)"
else
  ok "volume 'mindstrate-data' is free (will be created on first up)"
fi

# ---------- 5. Disk space ----------
section "5) Disk space (need at least 2 GiB free where docker stores data)"
docker_root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
free_kb=$(df -P "$docker_root" 2>/dev/null | awk 'NR==2 {print $4}')
if [ -n "${free_kb:-}" ] && [ "$free_kb" -gt 2097152 ]; then
  ok "$(df -h "$docker_root" 2>/dev/null | awk 'NR==2 {print $4}') free under $docker_root"
else
  warn "less than 2 GiB free under $docker_root — build may fail"
fi

# ---------- 6. Outcome ----------
section "Result"
if [ "$FAILED" -eq 0 ]; then
  ok "Preflight passed. Safe to run:"
  echo "    docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build"
  exit 0
else
  fail "Preflight failed. Fix the issues above and re-run."
  exit 1
fi
