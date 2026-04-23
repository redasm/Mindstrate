# syntax=docker/dockerfile:1.7
#
# Mindstrate Web UI — production image (Next.js 15 standalone)
# ----------------------------------------------------------------
# Next.js 15 with `output: 'standalone'` produces a self-contained tree
# under `.next/standalone/` that already includes:
#   - .next/standalone/server.js                   (NOT used in monorepo)
#   - .next/standalone/packages/web-ui/server.js   (entry in monorepo)
#   - .next/standalone/node_modules/...            (only the deps the app uses)
#   - .next/standalone/packages/core/...           (workspace pkg copied in)
#
# We only need to add back .next/static and public/ on top of standalone.
# The runtime image is therefore very small.
#
# Build (from repo root):
#   docker build -f deploy/web-ui.Dockerfile -t mindstrate/web-ui:latest .

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder

# Native build deps (better-sqlite3 needs python+make+g++).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/protocol/package.json       ./packages/protocol/package.json
COPY packages/client/package.json         ./packages/client/package.json
COPY packages/server/package.json         ./packages/server/package.json
COPY packages/team-server/package.json    ./packages/team-server/package.json
COPY packages/cli/package.json            ./packages/cli/package.json
COPY packages/mcp-server/package.json     ./packages/mcp-server/package.json
COPY packages/web-ui/package.json         ./packages/web-ui/package.json
COPY packages/obsidian-sync/package.json  ./packages/obsidian-sync/package.json

RUN npm ci --ignore-scripts

COPY packages/protocol  ./packages/protocol
COPY packages/client    ./packages/client
COPY packages/server    ./packages/server
COPY packages/web-ui    ./packages/web-ui

# better-sqlite3 native binding must match the runtime libc (glibc on bookworm).
RUN npm rebuild better-sqlite3 --workspace @mindstrate/server

# Build core then web-ui via turbo (respects dep graph).
RUN npx turbo build --filter=@mindstrate/web-ui

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tini \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 mindstrate \
 && useradd  --system --uid 1001 --gid mindstrate --home-dir /app --shell /usr/sbin/nologin mindstrate

WORKDIR /app
ENV NODE_ENV=production \
    MINDSTRATE_DATA_DIR=/data \
    PORT=3377 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1

# 1. Copy the entire standalone tree (server.js, node_modules, workspace pkgs).
COPY --from=builder --chown=mindstrate:mindstrate /app/packages/web-ui/.next/standalone ./

# 2. Layer back the static chunks and public assets that standalone doesn't ship.
COPY --from=builder --chown=mindstrate:mindstrate /app/packages/web-ui/.next/static ./packages/web-ui/.next/static
COPY --from=builder --chown=mindstrate:mindstrate /app/packages/web-ui/public       ./packages/web-ui/public

RUN mkdir -p /data && chown -R mindstrate:mindstrate /data
VOLUME ["/data"]

USER mindstrate
EXPOSE 3377

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
# Standard Next.js standalone entrypoint in monorepo layout.
CMD ["node", "packages/web-ui/server.js"]
