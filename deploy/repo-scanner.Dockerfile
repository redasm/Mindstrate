# syntax=docker/dockerfile:1.7
#
# Mindstrate repo-scanner — production image (daemon mode)
# ----------------------------------------------------------------
# Runs `mindstrate-scan daemon` as a long-lived container that polls
# configured Git/P4 sources on a schedule. In team mode the scanner
# pushes everything to a Team Server over HTTP, so this container
# does NOT need to share the team-server data volume — only its own
# scanner.db (cursors + failed-item retry queue).
#
# Build (from repo root):
#   docker build -f deploy/repo-scanner.Dockerfile -t mindstrate/repo-scanner:latest .

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 (scanner uses it for source-store)
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/protocol/package.json       ./packages/protocol/package.json
COPY packages/client/package.json         ./packages/client/package.json
COPY packages/server/package.json         ./packages/server/package.json
COPY packages/repo-scanner/package.json   ./packages/repo-scanner/package.json
COPY packages/team-server/package.json    ./packages/team-server/package.json
COPY packages/cli/package.json            ./packages/cli/package.json
COPY packages/mcp-server/package.json     ./packages/mcp-server/package.json
COPY packages/web-ui/package.json         ./packages/web-ui/package.json
COPY packages/obsidian-sync/package.json  ./packages/obsidian-sync/package.json

RUN npm ci --ignore-scripts

COPY packages/protocol      ./packages/protocol
COPY packages/client        ./packages/client
COPY packages/server        ./packages/server
COPY packages/repo-scanner  ./packages/repo-scanner

RUN npm rebuild better-sqlite3 --workspace @mindstrate/server

RUN npx turbo build --filter=@mindstrate/repo-scanner

RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# git is mandatory; p4 is optional and pulled in only when scanning P4 depots.
# Set INSTALL_P4=1 at build time to add the Helix CLI.
ARG INSTALL_P4=0
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tini openssh-client curl \
 && if [ "$INSTALL_P4" = "1" ]; then \
        curl -fsSL https://package.perforce.com/perforce.pubkey | gpg --dearmor -o /usr/share/keyrings/perforce.gpg \
     && echo "deb [signed-by=/usr/share/keyrings/perforce.gpg] https://package.perforce.com/apt/debian bookworm release" \
        > /etc/apt/sources.list.d/perforce.list \
     && apt-get update && apt-get install -y --no-install-recommends helix-p4d-base helix-cli ; \
    fi \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 mindstrate \
 && useradd  --system --uid 1001 --gid mindstrate --home-dir /home/mindstrate --create-home --shell /bin/bash mindstrate

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules                       ./node_modules
COPY --from=builder /app/packages/protocol/dist             ./packages/protocol/dist
COPY --from=builder /app/packages/protocol/package.json     ./packages/protocol/package.json
COPY --from=builder /app/packages/client/dist               ./packages/client/dist
COPY --from=builder /app/packages/client/package.json       ./packages/client/package.json
COPY --from=builder /app/packages/server/dist               ./packages/server/dist
COPY --from=builder /app/packages/server/package.json       ./packages/server/package.json
COPY --from=builder /app/packages/repo-scanner/dist         ./packages/repo-scanner/dist
COPY --from=builder /app/packages/repo-scanner/package.json ./packages/repo-scanner/package.json
COPY --from=builder /app/package.json                       ./package.json

# Scanner state (cursors, failed items) lives in ~/.mindstrate-scanner/
# Repos that the scanner needs to clone go under /repos (mountable volume).
RUN mkdir -p /home/mindstrate/.mindstrate-scanner /repos \
 && chown -R mindstrate:mindstrate /app /home/mindstrate /repos
VOLUME ["/home/mindstrate/.mindstrate-scanner", "/repos"]

USER mindstrate

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "packages/repo-scanner/dist/cli.js", "daemon"]
