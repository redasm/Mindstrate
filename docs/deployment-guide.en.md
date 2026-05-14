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
| LLM provider key | Optional, for semantic search and LLM-assisted enrichment |

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
TEAM_API_KEY=your-team-secret
MINDSTRATE_DATA_DIR=/data/mindstrate
OPENAI_API_KEY=sk-... # optional
```

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
| `OPENAI_API_KEY` | OpenAI-compatible provider key |
| `OPENAI_BASE_URL` | Optional custom provider base URL |
| `MINDSTRATE_EMBEDDING_MODEL` | Embedding model name |
| `MINDSTRATE_LOCALE` | Preferred output locale, for example `en` or `zh-CN` |
| `TEAM_PORT` | Team Server port |
| `TEAM_API_KEY` | Team Server API key |
| `TEAM_SERVER_URL` | Team Server URL used by clients/MCP |

Use `.env.example` and `deploy/.env.deploy.example` as templates.

## Operations

Recommended production controls:

- Run Team Server behind internal network controls or a reverse proxy.
- Set `TEAM_API_KEY` in production.
- Back up `MINDSTRATE_DATA_DIR` regularly.
- Keep provider secrets outside repository files.
- Run `mindstrate doctor` and graph evaluation commands during maintenance windows.

## Troubleshooting

If MCP cannot connect, rebuild the MCP package, verify the configured command path, and restart the AI tool. If Team Server calls fail, check `/health`, firewall rules, server logs, and API key consistency. If search quality is weak, verify whether an embedding provider is configured or whether the system is running in offline fallback mode.
