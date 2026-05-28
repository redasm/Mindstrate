# Installation Guide

This guide covers local personal setup, team member setup, Team Server deployment, MCP configuration, optional LLM providers, and what should be committed.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 20.19 or newer (Node 18 reached EOL in 2025-04 and is no longer tested) |
| npm | 10 or newer |
| Git | Required for source installation and Git collection |
| Docker | Required only for Docker Team Server deployment |
| p4 CLI | Optional, only for Perforce collection |
| OpenAI-compatible API | Optional; deterministic extraction and local hash embeddings work without it. In team mode this is configured per-project from the Web UI |

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

### 3. Web Console

Once Team Server is running, all team operations happen in the Web UI. Open `http://<server>:3377/login` and sign in with the `TEAM_API_KEY` from `.env.deploy`. That value is the **admin bootstrap key only** — do not hand it to members; member keys are minted from the Web UI under Settings → Users.

![Web UI login](images/login.jpg)

After signing in you land on Settings:

![Settings overview](images/setting_overview.jpg)

Complete the first-time setup in this order:

1. **Settings → Users**: mint an API key per member, choose `admin` or `member`, and restrict the key to the projects that member should reach (`*` means all projects). Distribute the key over a secure channel so the member can use it as `TEAM_API_KEY` in their MCP configuration.

   ![Users and API keys](images/setting_user.jpg)

2. **Settings → Scanner Sources**: register Git or P4 scanner sources per project (repo path, remote URL, auth token, poll interval, init mode). The scanner daemon reads this table directly — the old `MINDSTRATE_SCANNER_*` env vars are no longer used.

3. **Settings → LLM Configs**: configure OpenAI-compatible providers per project (API key, base URL, LLM model, embedding model, embedding dim). Projects without a config fall back to the 256-dim offline hash embedder and skip LLM extraction. See [LLM Provider Configuration](#llm-provider-configuration) for details.

For the member-facing browsing surface (knowledge, project graph, global search), see [Web Console — Member View](#web-console--member-view).

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

### Ports And Bind Address

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

> LLM providers, scanner sources, and member API keys are no longer driven by env vars — they live in the Web UI as per-project records. The `.env.deploy` file only carries ports, bind addresses, the admin bootstrap `TEAM_API_KEY`, log level, and locale.

### Deployment Troubleshooting

| Symptom | Fix |
| --- | --- |
| `TEAM_API_KEY must be set` | Check `deploy/.env.deploy` and make sure compose receives `--env-file` |
| Web UI is empty | Confirm Team Server and Web UI mount the same data volume |
| Client gets 401 Unauthorized | Match client `TEAM_API_KEY` with the server key |
| Healthcheck stays unhealthy | Check `docker logs mindstrate-team-server` |
| Web UI returns 502 after upgrade | Wait for Next.js startup or inspect `docker compose ... logs web-ui` |

## Team Member Setup

> Before a member can connect, the admin must mint an API key for them in the Web UI under `Settings → Users` (use the `member` role and restrict the key to the projects that member should reach). The `<key>` in the commands below refers to that **per-member key**, not the admin bootstrap `TEAM_API_KEY` from `.env.deploy`.

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

When `TEAM_SERVER_URL` is present, the MCP server runs in team mode and forwards reads/writes to Team Server instead of using local SQLite as the source of truth. Members can only access the projects their key is scoped to; cross-project access returns 403.

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

### Tell The AI When To Use Mindstrate MCP

MCP configuration only makes the tool available; it does not always make the AI use it proactively. For each project connected to Mindstrate, create or update an `AGENTS.md` file at the project root with project-level usage rules. Tools such as OpenCode, Cursor, and Claude Code can read agent instruction files and use them to decide when to query or write Mindstrate memory.

Example:

```md
# Agent Memory Rules

- Before planning non-trivial code changes, query Mindstrate for relevant project knowledge, project graph facts, prior decisions, and known risks.
- Use Mindstrate MCP to assemble task context when the task touches unfamiliar code, architecture boundaries, tests, deployment, or previous incidents.
- Query the project graph before editing files to understand ownership, dependencies, call chains, generated code, and blast radius.
- After fixing a bug, discovering a project convention, resolving a confusing setup issue, or learning a reusable workflow, write a concise memory entry to Mindstrate with evidence paths.
- Do not store secrets, API keys, credentials, personal data, or large raw logs in Mindstrate memory.
- Treat Mindstrate results as evidence-backed context, not as permission to skip reading source files or running tests.
```

If the project already has `AGENTS.md`, append these rules to the existing file. Do not overwrite team-specific coding, testing, and security instructions.

## LLM Provider Configuration

Mindstrate does not require an LLM. **Projects without an LLM config** fall back to deterministic extraction and a 256-dim local hash embedder — still usable, but semantic search quality is weaker and the LLM-driven extraction passes are skipped.

In team mode, LLM and embedding providers are configured per-project from the Web UI; the process-level env vars are gone. Open `Settings → LLM Configs → + Add config` and fill in:

| Field | Notes |
| --- | --- |
| Project | The project this config applies to. Only one config per project. |
| OpenAI API Key | Stored as plaintext in the shared SQLite, same handling as scanner credentials. |
| LLM Base URL | Optional; leave blank for OpenAI official. |
| Embedding Base URL | Optional; defaults to the LLM Base URL. |
| LLM Model | `gpt-4o-mini`, `qwen-max`, `deepseek-chat`, ... |
| Embedding Model | `text-embedding-3-small`, `text-embedding-v3`, `bge-m3`, ... The dimension auto-fills for common models. |
| Embedding Dim | Must match the actual model output. Different projects can use different dimensions; vectors live in separate per-project collections. |

Common OpenAI-compatible base URLs:

```text
OpenAI official:    https://api.openai.com/v1
Aliyun DashScope:   https://dashscope.aliyuncs.com/compatible-mode/v1
DeepSeek:           https://api.deepseek.com/v1
Moonshot:           https://api.moonshot.cn/v1
Local Ollama:       http://127.0.0.1:11434/v1
```

When a config is updated, the provider cache invalidates and the next embed/search uses the new model. Deleting a config drops the project back to offline mode automatically.

> Local personal mode (no Team Server) still accepts `OPENAI_API_KEY` injected into the local MCP process. Team Server LLM configuration is only managed through the Web UI.

## Web Console — Member View

After signing in with their own API key, members can use the Web UI to:

- Browse the project's knowledge entries and follow the ECS lineage (episode → snapshot → pattern → rule):

  ![Knowledge browser](images/knowledge.jpg)

- Browse project graph nodes, dependencies, blast radius, and edit-safety hints, and write structured overlays back into the graph:

  ![Project graph](images/project_graph.jpg)

- Run cross-project global search to locate knowledge entries, snapshots, or graph nodes:

  ![Global search](images/golbal_search.jpg)


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
