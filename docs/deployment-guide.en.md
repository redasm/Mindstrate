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
| `MINDSTRATE_LOCALE` | Preferred output locale, for example `en` or `zh-CN` |
| `TEAM_PORT` | Team Server port |
| `TEAM_API_KEY` | Team Server admin bootstrap key (member keys are minted in the Web UI) |
| `TEAM_SERVER_URL` | Team Server URL used by clients/MCP |
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
