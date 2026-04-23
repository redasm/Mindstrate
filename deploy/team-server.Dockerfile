# syntax=docker/dockerfile:1.7
#
# Mindstrate Team Server — production image
# ----------------------------------------------------------------
# Multi-stage build:
#   1) builder:  npm install + turbo build for protocol/client/server/team-server
#   2) runtime:  slim image with prod deps + dist + better-sqlite3 native binding
#
# Build (from repo root):
#   docker build -f deploy/team-server.Dockerfile -t mindstrate/team-server:latest .

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first so npm install can cache.
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

# Now copy only the sources we actually need to build the team server.
COPY packages/protocol       ./packages/protocol
COPY packages/client         ./packages/client
COPY packages/server         ./packages/server
COPY packages/team-server    ./packages/team-server

# Rebuild better-sqlite3 against the builder's node version.
RUN npm rebuild better-sqlite3 --workspace @mindstrate/server

# Build (turbo respects the dependency graph: protocol -> client -> server -> team-server)
RUN npx turbo build --filter=@mindstrate/team-server

# Prune dev deps to shrink the runtime image.
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# Minimal runtime tools for healthcheck (curl) and graceful sigs (tini).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl tini \
 && rm -rf /var/lib/apt/lists/*

# Run as non-root.
RUN groupadd --system --gid 1001 mindstrate \
 && useradd  --system --uid 1001 --gid mindstrate --home-dir /app --shell /usr/sbin/nologin mindstrate

WORKDIR /app
ENV NODE_ENV=production \
    MINDSTRATE_DATA_DIR=/data \
    TEAM_PORT=3388

# Copy only what runtime needs.
COPY --from=builder /app/node_modules                       ./node_modules
COPY --from=builder /app/packages/protocol/dist             ./packages/protocol/dist
COPY --from=builder /app/packages/protocol/package.json     ./packages/protocol/package.json
COPY --from=builder /app/packages/client/dist               ./packages/client/dist
COPY --from=builder /app/packages/client/package.json       ./packages/client/package.json
COPY --from=builder /app/packages/server/dist               ./packages/server/dist
COPY --from=builder /app/packages/server/package.json       ./packages/server/package.json
COPY --from=builder /app/packages/team-server/dist          ./packages/team-server/dist
COPY --from=builder /app/packages/team-server/package.json  ./packages/team-server/package.json
COPY --from=builder /app/package.json                       ./package.json

RUN mkdir -p /data && chown -R mindstrate:mindstrate /app /data
VOLUME ["/data"]

USER mindstrate
EXPOSE 3388

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${TEAM_PORT}/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/team-server/dist/server.js"]
