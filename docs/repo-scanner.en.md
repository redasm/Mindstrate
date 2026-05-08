# Repo Scanner

`packages/repo-scanner` is the external repository collection tool for Mindstrate. It collects Git and Perforce signals, normalizes them into change/event payloads, and sends those payloads into the Mindstrate runtime.

## Purpose

Repo scanner owns infrastructure-facing collection work:

- discover recent commits or changelists,
- manage cursors and retries,
- collect commit messages, file lists, diffs, and metadata,
- run manual or daemon collection workflows,
- emit standard Mindstrate events, changesets, or bundles.

It is not the knowledge store, retrieval engine, session system, or project graph source of truth.

## Why It Is Separate

Repository scanning depends on local working copies, Git/P4 executables, credentials, polling, cursors, and failure recovery. Those concerns are operational infrastructure, not core memory runtime. Keeping scanner separate prevents Git/P4 access requirements from leaking into `packages/server` and lets teams deploy the scanner only where repository access is available.

## Supported Workflows

Common commands:

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest git --recent 20 --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan source add-git --name repo --project my-project --repo-path .
mindstrate-scan daemon
```

The scanner can be used directly for one-off ingestion or as a daemon for repeated collection.

## Data Contract

Scanner output should be treated as source evidence, not final knowledge. The canonical flow is:

```text
Git / Perforce / custom source
  -> repo-scanner
  -> normalized event or ChangeSet
  -> Mindstrate events/context/project graph APIs
  -> ECS graph, project graph, retrieval, projections
```

The server decides how to store, compress, score, and expose the resulting context.

## Cursor And Retry Model

Scanner implementations should prefer incremental cursors over repeated “latest N” scans. For Git, the cursor is usually a commit hash. For Perforce, it is usually a changelist number. Failed items should be recorded for retry without corrupting the successful cursor state.

## Boundary Rules

Repo scanner may depend on `@mindstrate/protocol`, `@mindstrate/client`, and public server APIs where local ingestion is explicitly required. It must not duplicate knowledge extraction, retrieval ranking, project graph storage, or metabolism logic.

## Extension Points

Future scanner sources can add Git mirror, hosted Git provider APIs, CI events, build logs, and custom enterprise source systems. Each source should normalize into the same Mindstrate event/change shapes before ingestion.
