# Mindstrate Architecture

This document is the formal package-boundary guide for Mindstrate. It defines which package owns each responsibility, which dependencies are allowed, and where new capabilities should be added.

## Layer Model

```text
@mindstrate/protocol
  -> @mindstrate/client
  -> @mindstrate/server
  -> applications: cli, mcp-server, team-server, web-ui, obsidian-sync, repo-scanner
```

`protocol` is the shared contract layer. `client` is the Team Server HTTP client. `server` is the local runtime and canonical domain implementation. Applications compose those public APIs into user-facing commands, tools, services, and projections.

The detailed dependency direction is:

```text
                         @mindstrate/protocol

                       (zero runtime deps, types only)

                                   ^
                                   |
                            used by everyone
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
          @mindstrate/client                @mindstrate/server

         (HTTP client, fetch only)      (SQLite + OpenAI + ingestion
                                          + retrieval + quality)
                  ^                                 ^
                  |                                 |
         +--------+--------+              +---------+---------+
         |                 |              |         |         |
         v                 v              v         v         v
     mcp-server       any 3rd party      cli   team-server  web-ui
                      using the HTTP API                     |
                                                             v
                                                        obsidian-sync
                                                        (uses server)
```

## Package Responsibilities

| Package | Responsibility | Boundary |
| --- | --- | --- |
| `packages/protocol` | Shared DTOs, enums, tool schemas, graph and memory models | No business runtime dependencies |
| `packages/client` | HTTP client for Team Server APIs | Does not import server/native modules |
| `packages/server` | Core runtime, SQLite stores, retrieval, project graph, sessions, metabolism, projections | Does not own MCP, HTTP framing, or UI |
| `packages/mcp-server` | MCP tools and resources | Uses `protocol + client` by default; local mode dynamically loads server |
| `packages/cli` | `mindstrate` and `ms` command-line workflows | Calls public server/client APIs |
| `packages/team-server` | Team HTTP API and shared runtime deployment | Calls server facade/domain APIs |
| `packages/web-ui` | Team UI | Calls public server/client boundaries |
| `packages/obsidian-sync` | Obsidian projection and controlled sync | Uses server projection APIs |
| `packages/repo-scanner` | External repository event collection | Sends normalized changes/events into Mindstrate |

## Runtime API Shape

`Mindstrate` is a lifecycle facade. New behavior should be added under explicit subdomain APIs instead of flat proxy methods on the main class.

Primary domains:

- `memory.knowledge.*`: knowledge writes and quality checks.
- `memory.snapshots.*`: project snapshot upsert and queries.
- `memory.context.*`: ECS graph nodes, edges, conflicts, feedback, graph retrieval.
- `memory.assembly.*`: context curation and working-context assembly.
- `memory.events.*`: Git, test, LSP, terminal, session, and generic event ingestion.
- `memory.sessions.*`: session lifecycle, observations, compression, restore.
- `memory.metabolism.*`: digest, compression, reflection, pruning, scheduling.
- `memory.evaluation.*`: retrieval and graph evaluation.
- `memory.projections.*`: Obsidian, internalization, and other projections.
- `memory.bundles.*`: portable context bundle create, validate, install, publish.
- `memory.maintenance.*`: maintenance tasks and statistics.

## Import Rules

`protocol` may not import any `@mindstrate/*` package or runtime dependency. `client` may import `protocol` and platform-neutral HTTP primitives only. `mcp-server` must not statically import `server`; local mode must use dynamic import. Application packages should consume public APIs instead of reaching into internal server modules.

## Build Order

The intended build order is:

```text
protocol -> client -> server -> application packages
```

Cross-package API changes must be validated by building affected consumers, especially `cli`, `team-server`, `mcp-server`, `repo-scanner`, `obsidian-sync`, and `web-ui`.

## Adding A Package

When adding a package, define its domain responsibility first. Then add its `package.json`, `tsconfig.json`, build pipeline entry if needed, and dependency restrictions. Update this document and any lint/build restrictions that enforce the boundary.

## Design Rule

Prefer fewer, clearer boundaries. Do not create generic `utils`, `common`, or compatibility wrapper packages. A package should exist only when it owns a stable domain or deployment surface.
