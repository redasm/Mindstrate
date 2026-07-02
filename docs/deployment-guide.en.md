# Deployment Guide

This guide describes the supported Mindstrate deployment modes and operational configuration.

## Requirements

| Item | Requirement |
| --- | --- |
| Node.js | 20.19 or newer (Node 18 reached EOL in 2025-04 and is no longer tested) |
| npm | 10 or newer |
| OS | Windows, macOS, or Linux |
| Git | Optional, for Git collection workflows |
| Perforce CLI | Optional, for P4 collection workflows |
| LLM provider key | Optional; no longer passed via env vars — configured per project in the Web UI |

## Build From Source

```bash
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate
npm install
npx turbo build
npm link
```

Validate the CLI:

```bash
mindstrate --help
```

## Docker Build & Deploy

The repo ships per-service multi-stage Dockerfiles under `deploy/`. They all use the repo root as the build context and rely on Turborepo to build only the dependency chain of the target service.

| Service | Dockerfile | Entry | Container port |
| --- | --- | --- | --- |
| team-server | `deploy/team-server.Dockerfile` | `team-server/dist/server.js` | 3388 |
| web-ui | `deploy/web-ui.Dockerfile` | Next.js standalone `web-ui/server.js` | 3377 |
| repo-scanner | `deploy/repo-scanner.Dockerfile` | `repo-scanner/dist/cli.js daemon` | — |

All three services share one named volume `mindstrate-data:/data` (the same SQLite). The web-ui reads/writes that database directly rather than through the team-server HTTP API.

### Prepare configuration

```bash
cp deploy/.env.deploy.example deploy/.env.deploy
# Edit deploy/.env.deploy: set TEAM_API_KEY (e.g. `openssl rand -hex 32`) and adjust ports if needed
```

### Build & start with Compose

Build and start the core services (team-server + web-ui):

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build
```

Include the repo-scanner daemon (in the `scanner` profile, which is not started with the core services by default):

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d --build
```

> When repo-scanner is not started under the `scanner` profile, no scanning runs and configured scanner sources stay in the "waiting" state.

### Force a no-cache rebuild

`docker compose up` does not accept `--no-cache` directly; run `build --no-cache` first, then `up`:

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d
```

With the repo-scanner:

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d
```

To bake in the Helix (P4) CLI for P4 scanning (adds ~50 MB), pass the `INSTALL_P4=1` build arg:

```bash
INSTALL_P4=1 docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner build --no-cache
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy --profile scanner up -d
```

### Manual single-image build

The build context must be the repo root `.`:

```bash
docker build -f deploy/team-server.Dockerfile  -t mindstrate/team-server:latest  .
docker build -f deploy/web-ui.Dockerfile       -t mindstrate/web-ui:latest       .
docker build -f deploy/repo-scanner.Dockerfile -t mindstrate/repo-scanner:latest --build-arg INSTALL_P4=1 .
```

Add `--no-cache` to ignore all layer caches and rebuild from scratch:

```bash
docker build --no-cache -f deploy/team-server.Dockerfile -t mindstrate/team-server:latest .
```

### Verify

```bash
curl http://127.0.0.1:3388/health
```

Open `http://<host>:3377` in a browser.

## Local Mode

Local mode stores project data under the current project `.mindstrate/` directory and can optionally write Obsidian projections.

Mindstrate supports two deployment modes:

```text
+-------------------------------------------------------------+
| Local mode                       Team mode                  |
|                                                             |
| Member A                         Member A  Member B Member C|
|   |                              |         |         |       |
|   v                              v         v         v       |
| +--------+                    +-----+   +-----+   +-----+   |
| | MCP    |                    | MCP |   | MCP |   | MCP |   |
| | Server |                    +-----+   +-----+   +-----+   |
| +--------+                       |         |         |       |
|   |                              +---------+---------+       |
|   v                                        |                 |
| +--------+                                 v                 |
| | Local  |                           +-------------+         |
| | SQLite |                           | Team Server |         |
| +--------+                           | :3388       |         |
|                                      +-------------+         |
| Data stays local                   Centralized, shared data  |
| Best for personal use              Best for teams            |
+-------------------------------------------------------------+
```

```bash
cd /path/to/project
mindstrate setup --mode local --tool opencode --yes
mindstrate init
```

Use local mode for personal workflows, local project graph analysis, and single-user Obsidian output.

## Team Mode

Team mode uses a shared Team Server. Team members run local MCP servers that forward requests to the server over HTTP.

Typical Team Server environment:

```bash
TEAM_PORT=3388
TEAM_API_KEY=your-team-secret     # admin bootstrap key; member keys are minted in the Web UI
MINDSTRATE_DATA_DIR=/data/mindstrate
```

> LLM providers, scanner sources, and member API keys are governed per-project from the Web UI — they are no longer driven by env vars. The legacy `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `MINDSTRATE_LLM_MODEL` / `MINDSTRATE_EMBEDDING_MODEL` variables have been removed.

Start the server after building:

```bash
node packages/team-server/dist/server.js
```

Health check:

```bash
curl http://localhost:3388/health
```

Team member setup:

```bash
mindstrate setup \
  --mode team \
  --tool cursor \
  --team-server-url http://team-server:3388 \
  --team-api-key your-team-secret
```

## MCP Configuration

`mindstrate setup` or `mindstrate mcp setup` writes MCP configuration for supported tools. Secrets belong in environment variables or tool-specific MCP configuration, not in committed project config.

Common tools:

- Cursor: `.cursor/mcp.json`
- OpenCode: `opencode.json`
- Claude Desktop: global desktop config

Also append Mindstrate MCP usage rules to the project-root `AGENTS.md` so the AI knows to call Mindstrate when planning complex changes, querying the project graph, restoring context, or capturing reusable experience. See the full template in the [Installation Guide](installation.en.md#tell-the-ai-when-to-use-mindstrate-mcp).

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `MINDSTRATE_DATA_DIR` | Data directory for local or Team Server storage |
| `MINDSTRATE_DB_PATH` | Explicit SQLite database path |
| `MINDSTRATE_VECTOR_BACKEND` | `local` (default) or `qdrant` |
| `MINDSTRATE_QDRANT_URL` | Qdrant URL when the vector backend is `qdrant` |
| `MINDSTRATE_VECTOR_CANDIDATE_LIMIT` | Max node embeddings scanned per SQLite similarity search (default 5000) |
| `MINDSTRATE_EMBED_TIMEOUT_MS` | Per-request timeout for embedding the search query; on timeout search falls back to lexical (default 3000, 0 disables) |
| `MINDSTRATE_PROJECTION_CACHE_TTL_MS` | TTL for the projection cache reused across searches; writes invalidate it (default 5000, 0 disables) |
| `MINDSTRATE_LOCALE` | Preferred output locale, for example `en` or `zh-CN` |
| `TEAM_PORT` | Team Server port |
| `TEAM_API_KEY` | Team Server admin bootstrap key (member keys are minted in the Web UI) |
| `TEAM_SERVER_URL` | Team Server URL used by clients/MCP |
| `TEAM_HTTP_TIMEOUT_MS` | HTTP request timeout (ms) for team-mode calls (default 30000) |
| `LOG_LEVEL` | Log level |

Use `.env.example` and `deploy/.env.deploy.example` as templates.

> **Removed env vars**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_EMBEDDING_BASE_URL`, `MINDSTRATE_LLM_MODEL`, `MINDSTRATE_EMBEDDING_MODEL`, and `MINDSTRATE_SCANNER_*`. These settings are now managed per project under Web UI `Settings → LLM Configs` and `Settings → Scanner Sources`.

## Operations

Recommended production controls:

- Run Team Server behind internal network controls or a reverse proxy.
- Set `TEAM_API_KEY` in production (admin bootstrap only — never distribute it to members).
- Mint per-member, project-scoped API keys via Web UI `Settings → Users`.
- Back up `MINDSTRATE_DATA_DIR` regularly (it carries SQLite, vector collections, and all Web UI configuration).
- Rotate LLM provider keys directly in `Settings → LLM Configs`; the provider cache invalidates automatically.
- Run `mindstrate doctor` and graph evaluation commands during maintenance windows.

## Troubleshooting

If MCP cannot connect, rebuild the MCP package, verify the configured command path, and restart the AI tool. If Team Server calls fail, check `/health`, firewall rules, server logs, and API key consistency. If search quality is weak, confirm whether the project has a config under Web UI `Settings → LLM Configs`, or whether it is currently on the offline fallback (256-dim local hash embedder with LLM extraction skipped).
