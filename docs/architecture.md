# Mindstrate Architecture

## Package Layers

```
                         @mindstrate/protocol
                       (zero runtime deps, types only)
                                  ▲
                                  │ used by everyone
                  ┌───────────────┼───────────────┐
                  │                               │
       @mindstrate/client            @mindstrate/server
        (HTTP client, fetch only)       (SQLite + OpenAI + ingestion
                  ▲                      + retrieval + quality)
                  │                               ▲
                  │                               │
       ┌──────────┴────────┐         ┌────────────┼──────────────┐
       │                   │         │            │              │
   mcp-server         (any 3rd        cli      team-server    web-ui
                      party using                                │
                      the HTTP API)                          obsidian-sync
                                                              (uses server)
```

### Why these boundaries exist

The single most painful class of bug we kept hitting before the v0.2 refactor
was **"team-only client distribution failed because some seemingly innocent
import dragged in better-sqlite3 (a native module)"**. The protocol/client/
server split makes the dependency graph physical:

- **Anything that needs to talk to a Mindstrate server over HTTP**
  uses `protocol` + `client`. Pure JS, zero native deps, runs anywhere.
- **Anything that needs to actually execute the storage / retrieval /
  embedding logic** uses `server`. Has SQLite, has OpenAI, requires a
  Node toolchain on the host that built it.

The MCP server straddles both worlds: it's a `protocol+client` consumer by
default (team mode), and lazily loads `server` only when running in local
mode. This is enforced at lint time — see `.eslintrc.cjs`.

## Package responsibilities

| Package | Owns | Forbidden from |
|---------|------|---------------|
| `protocol` | TypeScript types/enums for ECS context graph, graph knowledge views, sessions, pipeline/evolution results, errors | Any runtime dependency, any `@mindstrate/*` import |
| `client` | `TeamClient` HTTP wrapper around the Team Server REST API | `server`, `obsidian-sync`, native modules |
| `server` | ECS context graph store, vector index, embedder, metabolism engine, graph retrieval/injection interfaces, project detection, the `Mindstrate` facade class | Any platform-specific concern (HTTP framing, MCP, Next.js) |
| `mcp-server` | MCP protocol handlers, `bin/mindstrate-mcp` esbuild bundle | Static import of `server` or `obsidian-sync` |
| `team-server` | Express HTTP API in front of `Mindstrate`, API-key auth | Direct DB access; goes through `server` facade |
| `cli` | Commander.js commands wrapping `Mindstrate` for terminal use | — |
| `web-ui` | Next.js 15 SSR UI reading the same SQLite via `server` | — |
| `obsidian-sync` | Bidirectional sync between `Mindstrate` and an Obsidian vault | — |

## Import rules in code

### From `protocol`
- Allowed: nothing (`type` imports of internal sibling files only).

### From `client`
- Allowed: `@mindstrate/protocol`, Node built-ins.

### From `server`
- Allowed: `@mindstrate/protocol`, `@mindstrate/client` (for re-export
  convenience), `better-sqlite3`, `openai`, `uuid`, Node built-ins.

### From `mcp-server`
- Allowed (top-level): `@mindstrate/protocol`, `@mindstrate/client`,
  `@modelcontextprotocol/sdk`, `pino`, `zod`, Node built-ins.
- Allowed (lazy via `await import(...)` inside init only):
  `@mindstrate/server`, `@mindstrate/obsidian-sync`.
- Forbidden: top-level static import of `server` or `obsidian-sync` —
  enforced by ESLint rule `no-restricted-imports`.

### From `cli` / `team-server` / `web-ui` / `obsidian-sync`
- Allowed: anything needed. They are the "leaf consumers" that wire everything
  together.

## Build pipeline

`turbo.json` enforces topological order:
```
protocol → client → server → (everything else in parallel)
```

For the MCP server, `npm run build` runs `tsc && npm run bundle`, where
`bundle` is an esbuild step (see `packages/mcp-server/scripts/bundle.mjs`)
that produces a single self-contained `bundle/mindstrate-mcp.js` (~1.2 MB).
This is what gets shipped via the install script — no node_modules required
on the team member's machine.

## Distribution shape

| Audience | Gets shipped |
|---------|-------------|
| **Server admin** | `deploy/` (compose + Dockerfiles), built from full repo via `git clone` |
| **Team member** | A single `mindstrate-mcp.js` file, downloaded via `install.sh` / `install.ps1` from internal Nginx. Requires only Node.js 18+. No git, no npm, no native build tools. |
| **3rd-party HTTP integrator** | (Future) `npm install @mindstrate/client` |

## Adding a new package

1. Create `packages/<name>/` with `package.json` + `tsconfig.json` (composite).
2. List its allowed dependencies in **this document**.
3. Add a corresponding `overrides` block in `.eslintrc.cjs` if it has
   architectural restrictions (e.g. "must not import server").
4. Wire it into `turbo.json` if it has a non-default build pipeline.
5. Update the diagram at the top of this file.
