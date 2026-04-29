# Data Collection Guide

Mindstrate keeps external data collection outside the core framework.

Current boundary:

- `packages/repo-scanner` owns Git, Perforce, hooks, daemon polling, cursors, failed item retry, and custom source adapters.
- `packages/server` owns standard input ingestion, project graph parsing/merge/query/projection, sessions, and knowledge APIs.
- CLI and MCP expose these APIs without making the framework read Git, Perforce, or watcher state directly.

## Standard Inputs

External collectors should convert raw source data into three Mindstrate input types:

| Input | Use | Ingestion path |
| --- | --- | --- |
| `event` | Git, test, LSP, terminal, user feedback signals | `memory.events.ingestEvent(...)` |
| `changeset` | Project graph change impact analysis | `memory.context.ingestProjectGraphChangeSet(...)` or `mindstrate graph ingest --changes` |
| `bundle` | Portable context graph data | `memory.bundles.installBundle(...)` or publish flow |

Project graph `ChangeSet` example:

```json
{
  "source": "p4",
  "base": "123",
  "head": "124",
  "files": [
    {
      "path": "Source/Client/Client.Build.cs",
      "oldPath": "Source/OldClient/Client.Build.cs",
      "status": "renamed",
      "language": "csharp",
      "layerId": "gameplay-cpp"
    }
  ]
}
```

Analyze changes:

```bash
mindstrate graph ingest --changes changeset.json
cat changeset.json | mindstrate graph ingest --changes -
```

## Git One-Shot Collection

```bash
mindstrate-scan ingest git --last-commit --project my-project
mindstrate-scan ingest git --commit abc1234 --project my-project
mindstrate-scan ingest git --recent 10 --project my-project
mindstrate-scan ingest git --recent 5 --project my-project --dry-run
```

With `TEAM_SERVER_URL` and `TEAM_API_KEY`, scanner writes directly to Team Server:

```bash
TEAM_SERVER_URL=http://team-server:3388 \
TEAM_API_KEY=<key> \
mindstrate-scan ingest git --last-commit --project my-project
```

## Git Hook

Install a post-commit hook:

```bash
cd /path/to/repo
mindstrate-scan hook install
```

Uninstall:

```bash
mindstrate-scan hook uninstall
```

The hook calls `mindstrate-scan ingest git --last-commit`. Hook logic belongs in `repo-scanner`; do not add watcher or hook collection back into `packages/server`.

## Incremental Git Source

Register a source:

```bash
mindstrate-scan source add-git \
  --name app \
  --project my-project \
  --repo-path /path/to/repo \
  --branch main \
  --interval-sec 300 \
  --init-mode from_now
```

Backfill recent commits:

```bash
mindstrate-scan source add-git \
  --name app \
  --project my-project \
  --repo-path /path/to/repo \
  --init-mode backfill_recent \
  --backfill-count 20
```

Run once:

```bash
mindstrate-scan run <source-id>
```

Daemon mode:

```bash
mindstrate-scan daemon --tick-ms 30000
```

Inspect and recover:

```bash
mindstrate-scan status <source-id>
mindstrate-scan runs <source-id>
mindstrate-scan failed <source-id>
mindstrate-scan retry-failed <source-id>
```

Scanner state is stored separately:

```text
~/.mindstrate-scanner/scanner.db
```

## Perforce Collection

One-shot collection:

```bash
mindstrate-scan ingest p4 --changelist 12345 --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project
mindstrate-scan ingest p4 --recent 20 --depot //depot/MyProject/... --project my-project
mindstrate-scan ingest p4 --recent 10 --project my-project --dry-run
```

Server trigger example:

```text
mindstrate-capture change-commit //depot/... "mindstrate-scan ingest p4 --changelist %changelist% --project my-project"
```

Client cron example:

```cron
*/30 * * * * mindstrate-scan ingest p4 --recent 5 --project my-project 2>/dev/null
```

Windows scheduled task:

```batch
schtasks /create /tn "Mindstrate-P4-Scan" /tr "mindstrate-scan ingest p4 --recent 5 --project my-project" /sc minute /mo 30
```

## Custom Collectors

Custom collectors implement `RepoScannerSourceAdapter<TItem>` and emit standard Mindstrate inputs.

```ts
import { ChangeSource, type ChangeSet } from '@mindstrate/server';
import type { RepoScannerSourceAdapter } from '@mindstrate/repo-scanner';

export const p4ReviewAdapter: RepoScannerSourceAdapter<{ id: string; files: string[] }> = {
  id: 'p4-review',
  kind: 'p4-review',
  async discover({ sourceId, cursor }) {
    return {
      cursor: '101',
      items: [{ id: '101', files: ['Source/Client/Client.Build.cs'] }],
    };
  },
  async toMindstrateInput(item) {
    const changeSet: ChangeSet = {
      source: ChangeSource.P4,
      head: item.id,
      files: item.files.map((file) => ({ path: file, status: 'modified' })),
    };

    return {
      type: 'changeset',
      project: 'my-project',
      changeSet,
    };
  },
};
```

Collector responsibilities:

- discover external changes,
- maintain or receive cursors,
- convert raw source items into standard Mindstrate inputs,
- retry failed items,
- avoid sending secrets or unnecessary source content.

Framework responsibilities:

- validate and ingest events,
- analyze project graph `ChangeSet` inputs,
- install bundles,
- provide query and projection APIs.

## Project Graph Change Analysis

`mindstrate graph ingest --changes` does not read or mutate Git/P4. It only maps changed files to project graph nodes, layers, risk hints, and suggested queries.

Example output:

```text
Source: p4
Files: 1
Affected nodes: 2
Affected layers: gameplay-cpp

Risk hints:
  - Do not edit generated Unreal output unless explicitly requested.

Suggested queries:
  - mindstrate graph context Source/Client/Client.Build.cs
```

Run change analysis before agents edit large projects, Unreal projects, generated-heavy projects, monorepos, or custom collector outputs.

## Security Notes

- Do not write API keys into scanner source config.
- Prefer environment variables for `TEAM_SERVER_URL` and `TEAM_API_KEY`.
- Custom collectors are trusted code; use declarative project rules for untrusted repositories.
- Keep scanner cursor DB separate from the Mindstrate knowledge DB.
