# Installation Guide

This guide covers local personal setup, team member setup, Team Server deployment, MCP configuration, optional LLM providers, and what should be committed.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 18 or newer |
| npm | 10 or newer |
| Git | Required for source installation and Git collection |
| Docker | Required only for Docker Team Server deployment |
| p4 CLI | Optional, only for Perforce collection |
| OpenAI-compatible API | Optional; deterministic extraction and local hash embeddings work without it |

## Build From Source

```bash
git clone https://github.com/redasm/Mindstrate.git
cd Mindstrate
npm install
npx turbo build
```

For development, link the CLI globally:

```bash
npm link
mindstrate --help
```

If `mindstrate` is not on `PATH`, call the built entry directly:

```bash
node /path/to/Mindstrate/packages/cli/dist/index.js --help
```

Windows:

```powershell
node C:\AppProject\Mindstrate\packages\cli\dist\index.js --help
```

## Local Personal Setup

Use this for one developer and one local project. Data is stored under `.mindstrate/`; Obsidian output is optional.

```bash
cd /path/to/your/project
mindstrate setup --mode local
```

The wizard will:

- detect the project,
- write `.mindstrate/config.json`,
- initialize local data under `.mindstrate/`,
- generate a project snapshot,
- build the project graph,
- optionally export the project graph to an Obsidian vault,
- write MCP config for Cursor, OpenCode, Claude Desktop, or all supported tools.

Non-interactive local setup:

```bash
mindstrate setup --mode local --tool opencode --yes
```

With Obsidian:

```bash
mindstrate setup \
  --mode local \
  --tool cursor \
  --vault ~/Documents/MindstrateVault
```

Verify:

```bash
mindstrate graph status
mindstrate graph query "entry point"
```

## Team Server Deployment

For teams, deploy Team Server and Web UI on an internal server. Members connect through local MCP processes over HTTP.

### 1. Generate Deployment Config

Run from the Mindstrate repository root:

```bash
mindstrate setup --mode team-deploy
```

The wizard writes `deploy/.env.deploy`. Required values:

```env
TEAM_API_KEY=<long-random-secret>
TEAM_PORT=3388
WEB_UI_PORT=3377
```

Generate a key:

```bash
openssl rand -hex 32
```

### 2. Start Team Server And Web UI

```bash
bash deploy/preflight.sh
docker compose -f deploy/docker-compose.deploy.yml \
  --env-file deploy/.env.deploy \
  up -d --build
```

Check services:

```bash
curl http://127.0.0.1:3388/health
# Web UI: http://<server>:3377
```

### Deployment Files

```text
deploy/
├── docker-compose.deploy.yml
├── .env.deploy.example
├── team-server.Dockerfile
├── web-ui.Dockerfile
├── preflight.sh
├── export-data-volume.sh
└── restore.sh
```

The Docker deployment uses its own compose project, network, and volume. It does not touch existing containers, networks, or volumes on the host. Team Server and Web UI must share the same SQLite data directory; do not point them at different volumes.

### Operations

```bash
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy logs -f
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy restart
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d --build
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy down
```

### Backup And Restore

```bash
bash deploy/export-data-volume.sh
EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh

docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy stop
bash deploy/restore.sh ./data-exports/mindstrate-20260420-101500.tgz
docker compose -f deploy/docker-compose.deploy.yml --env-file deploy/.env.deploy up -d
```

Example cron backup:

```cron
0 3 * * * cd /opt/Mindstrate && EXPORT_DIR=/srv/mindstrate-data-exports bash deploy/export-data-volume.sh >> /var/log/mindstrate-data-export.log 2>&1
```

### Ports, Bind Address, And OpenAI

If `preflight.sh` reports a port conflict, edit `deploy/.env.deploy`:

```env
TEAM_PORT=4388
WEB_UI_PORT=4377
```

To expose services only to a local reverse proxy:

```env
TEAM_BIND=127.0.0.1
WEB_UI_BIND=127.0.0.1
```

Without `OPENAI_API_KEY`, the service uses offline hash embeddings and deterministic extraction. When an OpenAI-compatible key is configured, embedding and LLM extraction are enabled.

### Deployment Troubleshooting

| Symptom | Fix |
| --- | --- |
| `TEAM_API_KEY must be set` | Check `deploy/.env.deploy` and make sure compose receives `--env-file` |
| Web UI is empty | Confirm Team Server and Web UI mount the same data volume |
| Client gets 401 Unauthorized | Match client `TEAM_API_KEY` with the server key |
| Healthcheck stays unhealthy | Check `docker logs mindstrate-team-server` |
| Web UI returns 502 after upgrade | Wait for Next.js startup or inspect `docker compose ... logs web-ui` |

## Team Member Setup

Each member runs this inside their project:

```bash
cd /path/to/your/project
mindstrate setup \
  --mode team \
  --tool cursor \
  --team-server-url http://<server>:3388 \
  --team-api-key <key>
```

The wizard writes MCP config and injects:

```env
TEAM_SERVER_URL=http://<server>:3388
TEAM_API_KEY=<key>
```

When `TEAM_SERVER_URL` is present, the MCP server runs in team mode and forwards reads/writes to Team Server instead of using local SQLite as the source of truth.

## Team Member Installer Package

Admins can build a single-file MCP installer so members do not need to clone the repository:

```bash
bash install/build-installer.sh
```

Build output:

```text
install/dist/
  mindstrate-mcp.js
  install.sh
  install.ps1
  manifest.json
```

Before publishing, change the download URL in `install/install.sh` and `install/install.ps1` to your internal HTTP address, for example:

```text
http://internal.company.com/mindstrate
```

Then publish and verify:

```bash
bash install/build-installer.sh
rsync -avz install/dist/ user@nginx:/var/www/share/mindstrate/
curl http://internal.company.com/mindstrate/manifest.json
```

Member install commands:

Linux / macOS:

```bash
curl -fsSL http://<host>/mindstrate/install.sh \
  | TEAM_SERVER_URL=http://<server>:3388 \
    TEAM_API_KEY=<key> \
    TOOL=opencode \
    bash
```

Windows PowerShell:

```powershell
$env:TEAM_SERVER_URL = "http://<server>:3388"
$env:TEAM_API_KEY = "<key>"
$env:TOOL = "opencode"
iwr http://<host>/mindstrate/install.ps1 -UseBasicParsing | iex
```

Default install location:

| OS | Path |
| --- | --- |
| Linux / macOS | `~/.mindstrate-mcp/mindstrate-mcp.js` |
| Windows | `%USERPROFILE%\\.mindstrate-mcp\\mindstrate-mcp.js` |

The installer merges the `mindstrate` MCP entry into existing tool config and does not overwrite the whole config file.

Verify:

```bash
TEAM_SERVER_URL=http://<server>:3388 \
TEAM_API_KEY=<key> \
node ~/.mindstrate-mcp/mindstrate-mcp.js
```

Upgrade by running the installer again. It fetches the latest `manifest.json`, downloads `mindstrate-mcp.js`, checks SHA256, and keeps existing MCP config.

Uninstall by deleting the local install directory and removing `mindstrate` from the AI tool MCP config:

```bash
rm -rf ~/.mindstrate-mcp
```

Windows:

```powershell
Remove-Item -Recurse $env:USERPROFILE\.mindstrate-mcp
```

The installer only installs the single-file MCP server and connects it to Team Server. Git, Perforce, hooks, daemon polling, and custom collectors are provided by `packages/repo-scanner`.

Common issues:

| Symptom | Fix |
| --- | --- |
| `Cannot fetch manifest.json` | Check the internal HTTP URL, uploaded files, and member network access |
| `401 Unauthorized` | Check `TEAM_API_KEY` |
| `Team Server is not reachable` | Check `TEAM_SERVER_URL`, VPN, server status, and port access |
| Install succeeds but tools are missing | Restart the AI tool and confirm config was written to the expected path |

## MCP Configuration

Recommended commands:

```bash
mindstrate mcp setup --tool cursor
mindstrate mcp setup --tool opencode
mindstrate mcp setup --tool claude-desktop --global
```

Cursor project config example:

```json
{
  "mcpServers": {
    "mindstrate": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/server.js"],
      "env": {
        "MINDSTRATE_DATA_DIR": ".mindstrate"
      }
    }
  }
}
```

Team mode adds:

```json
{
  "TEAM_SERVER_URL": "http://<server>:3388",
  "TEAM_API_KEY": "<key>"
}
```

## LLM Provider Configuration

Mindstrate does not require an LLM. Without `OPENAI_API_KEY`, it uses deterministic extraction and local hash embeddings.

Configure an OpenAI-compatible provider for stronger semantic search, commit extraction, graph enrichment, and knowledge evolution:

```bash
mindstrate setup \
  --openai-api-key sk-... \
  --openai-base-url https://api.openai.com/v1 \
  --llm-model gpt-4o-mini \
  --embedding-model text-embedding-3-small
```

Common compatible providers:

```bash
# DashScope compatible mode
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
MINDSTRATE_LLM_MODEL=qwen-max
MINDSTRATE_EMBEDDING_MODEL=text-embedding-v3

# Moonshot
OPENAI_BASE_URL=https://api.moonshot.cn/v1
MINDSTRATE_LLM_MODEL=moonshot-v1-32k

# Local Ollama-compatible endpoint
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://127.0.0.1:11434/v1
MINDSTRATE_LLM_MODEL=qwen2.5
```

## What To Commit

Commit:

- `.mindstrate/project.json`
- `.mindstrate/config.json` if it has no secrets and your team wants shared defaults
- `.mindstrate/rules/*.json`
- repository entry projections such as `PROJECT_GRAPH.md`

Do not commit:

- `.mindstrate/mindstrate.db*`
- `.mindstrate/vectors/`
- Team API keys
- local Obsidian vault contents unless your team intentionally stores them in the repository

`mindstrate init` creates `.mindstrate/.gitignore`, which ignores local DB/vector files while allowing `project.json`.
