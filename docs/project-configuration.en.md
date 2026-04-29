# Project Configuration

Mindstrate stores project-level configuration under `.mindstrate/`.

There are three separate concepts:

- `.mindstrate/project.json`: project identity written by `mindstrate init` or `mindstrate setup`.
- `.mindstrate/config.json`: CLI/setup defaults such as mode, data directory, AI tool, vault, and Team Server URL.
- `.mindstrate/rules/*.json`: custom project detection rules used to enrich snapshots and project graph hints.

Local databases and vector files also live under `.mindstrate/`, but they are ignored by Git by default.

## `.mindstrate/project.json`

`project.json` can be committed. It lets collaborators rerun `mindstrate init` against a stable project identity instead of relying only on auto-discovery.

Example:

```json
{
  "version": 1,
  "name": "my-project",
  "rootHint": "/Users/me/code/my-project",
  "language": "typescript",
  "framework": "react",
  "snapshotKnowledgeId": "project-snapshot:...",
  "createdAt": "2026-04-29T10:00:00.000Z",
  "updatedAt": "2026-04-29T10:00:00.000Z",
  "fingerprint": "typescript|react|@vitejs/plugin-react,react,vite"
}
```

Fields:

| Field | Meaning |
| --- | --- |
| `version` | Meta schema version. Current value is `1`. |
| `name` | Detected project name. |
| `rootHint` | Absolute path from the last init; informational only. |
| `language` | Detected primary language. |
| `framework` | Detected framework. |
| `snapshotKnowledgeId` | Stable project snapshot knowledge ID. |
| `createdAt` / `updatedAt` | ISO timestamps. |
| `fingerprint` | Dependency/language/framework fingerprint used to skip unnecessary snapshot updates. |

`mindstrate init` creates `.mindstrate/.gitignore`, which ignores local DB files while allowing `project.json`.

## `.mindstrate/config.json`

`config.json` is written by `mindstrate setup` and read by CLI commands.

Local example:

```json
{
  "version": 1,
  "mode": "local",
  "tool": "cursor",
  "vaultPath": "/Users/me/Documents/MindstrateVault",
  "dataDir": ".mindstrate"
}
```

Team example:

```json
{
  "version": 1,
  "mode": "team",
  "tool": "opencode",
  "teamServerUrl": "http://team-server:3388",
  "dataDir": ".mindstrate"
}
```

Fields:

| Field | Meaning |
| --- | --- |
| `version` | Config schema version. Current value is `1`. |
| `mode` | `local` or `team`. |
| `dataDir` | Project-relative data directory. |
| `tool` | `cursor`, `opencode`, `claude-desktop`, or `all`. |
| `vaultPath` | Optional Obsidian vault path for local mode. |
| `teamServerUrl` | Optional Team Server URL for team mode. |

Do not commit secrets. `TEAM_API_KEY` should live in environment variables or generated MCP config, not shared project config.

## Built-In Project Rules

Mindstrate ships declarative built-in detection rules under:

```text
packages/server/src/project/rules/
```

Current built-ins:

- `react-project.json`
- `vite-project.json`
- `vue-project.json`
- `nextjs-project.json`
- `nuxt-project.json`
- `unreal-project.json`

Rules can provide:

- detection conditions,
- framework/language/package manager hints,
- entry points,
- top directory descriptions,
- snapshot overview/invariants/conventions,
- parser/query/convention extractor hints,
- source roots and generated roots,
- risk hints,
- project graph layers.

## Custom Project Rules

Project-local rules live under:

```text
.mindstrate/rules/*.json
```

Custom rules can override built-ins. Higher priority wins; if priorities tie, project-local rules win.

Minimal example:

```json
{
  "id": "internal-service",
  "name": "Internal Node Service",
  "priority": 95,
  "match": {
    "all": [
      { "file": "package.json" },
      { "dir": "src" },
      { "packageDependency": "express" }
    ]
  },
  "detect": {
    "language": "typescript",
    "framework": "internal-service",
    "manifest": "package.json",
    "entryPoints": ["src/server.ts"],
    "topDirs": {
      "src": "Service source code.",
      "config": "Runtime configuration.",
      "migrations": "Database migration files."
    }
  },
  "snapshot": {
    "overview": "This is an internal HTTP service.",
    "invariants": [
      "Do not change migration history after it has been applied.",
      "Keep request validation near route boundaries."
    ],
    "conventions": [
      "Treat src/server.ts as the process entry point.",
      "Prefer config files over hard-coded environment names."
    ]
  },
  "sourceRoots": ["src"],
  "generatedRoots": ["dist", "coverage"],
  "ignore": ["node_modules", "dist", "coverage"],
  "riskHints": [
    "Do not edit generated build output."
  ],
  "layers": [
    {
      "id": "service-source",
      "label": "Service Source",
      "roots": ["src"],
      "language": "typescript",
      "parserAdapters": ["tree-sitter-source"],
      "queryPacks": ["typescript"],
      "changeAdapters": ["git"]
    }
  ]
}
```

## Rule Field Reference

| Field | Meaning |
| --- | --- |
| `id` | Stable rule ID. |
| `name` | Human-readable rule name. |
| `priority` | Higher value wins. |
| `match` | Conditions that decide whether the rule matches. |
| `detect` | Project identity and structure hints. |
| `snapshot` | Project snapshot text hints. |
| `parserAdapters` | Parser adapter IDs. |
| `queryPacks` | Query pack IDs. |
| `conventionExtractors` | Convention extractor IDs. |
| `sourceRoots` | Source directories. |
| `generatedRoots` | Generated directories for ignore/risk handling. |
| `ignore` | Additional project graph ignore paths. |
| `manifests` | Manifest files or globs. |
| `riskHints` | Risk hints shown during change analysis. |
| `layers` | Project graph layer definitions. |

Supported match operators:

- `file`
- `dir`
- `glob`
- `readmeContains`
- `jsonPath`
- `tomlKey`
- `packageDependency`

Supported match groups:

- `all`: every condition must match.
- `any`: at least one condition must match.
- `none`: no condition may match.

## Project Graph Layers

Layers help change analysis explain affected areas.

```json
{
  "id": "gameplay-cpp",
  "label": "Gameplay C++",
  "roots": ["Source", "Plugins"],
  "language": "cpp",
  "parserAdapters": ["tree-sitter-source", "unreal-build"],
  "queryPacks": ["cpp-light", "csharp-build-light"],
  "changeAdapters": ["git", "p4"]
}
```

Layer fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable layer ID. |
| `label` | Human-readable name. |
| `roots` | Paths that belong to this layer. |
| `language` | Optional language hint. |
| `parserAdapters` | Parser adapters for this layer. |
| `queryPacks` | Query packs for this layer. |
| `conventionExtractors` | Optional convention extractor IDs. |
| `changeAdapters` | `git`, `p4`, `filesystem`, or `manual`. |
| `generated` | Marks generated output layers. |

## Safety Boundary

Project rules are declarative JSON data. Mindstrate does not execute JavaScript, shell commands, or network requests from rules. This keeps untrusted repositories safe to inspect.

For deeper rule design, see [Project Detection Rules](project-detection-rules.en.md).
