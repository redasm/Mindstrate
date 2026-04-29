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

For backup, restore, port conflicts, and upgrades, see [deploy/README.md](../deploy/README.md).

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

Publish `install/dist/` on an internal HTTP server.

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

See [install/README.md](../install/README.md) for publishing, upgrades, and uninstall.

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
