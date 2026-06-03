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

> **Team-mode tip**: admins can also add/edit/toggle Git and P4 sources from the Web UI under `Settings → Scanner Sources`. The daemon reads the same SQLite table either way. The CLI is still supported and is most useful for local personal mode or scripted setups.

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

### Git Auth: Use a PAT / Deploy Token

If the remote Git server requires authentication (private repositories), fill the Scanner Source `Auth token` field with a **Personal Access Token** or **Deploy Token**.

The format is auto-detected by whether the token contains a colon:

| Token format | Authorization header injected | Servers that accept it |
| --- | --- | --- |
| `ghp_xxx` / `glpat-xxx` / `xoxp-xxx` (no colon) | `Bearer <token>` | GitHub PAT, Bitbucket Server PAT |
| `token-name:token-value` (contains a colon) | `Basic base64(token-name:token-value)` | GitLab Deploy Token, Gitea PAT/Token, self-hosted Git |
| `oauth2:<gitlab-pat>` | `Basic base64(oauth2:<gitlab-pat>)` | GitLab PAT over Git HTTPS |
| `:<azure-devops-pat>` (leading colon) | `Basic base64(:<pat>)` with empty user | Azure DevOps PAT |

**Do not** use a username + password — passwords leak into `.git/config` and the container `ps` output, and they cannot be rotated independently.

Token entry points for common Git servers:

| Server | Where to mint | Recommended scope |
| --- | --- | --- |
| GitHub | Settings → Developer settings → Personal access tokens (classic or fine-grained) | `repo:read` only |
| GitLab | User Settings / Project / Group → Access Tokens | `read_repository` |
| Gitea | User Settings → Applications → Generate New Token | `repository: read` |
| Bitbucket Server | Personal access tokens | Project read |
| Azure DevOps | User Settings → Personal access tokens | `Code: Read` |

If the server only supports SSH, deploy an SSH key on the scanner host/container, register it as a deploy key on the Git server, set `Remote URL` to `git@host:org/repo.git`, and leave `Auth token` blank.

### Large repos (>10 GB) deployment pattern

By default the scanner runs `git clone --mirror` into `${REPO_SCANNER_REPOS_DIR}/<source-id>` (defaults to `/repos/<uuid>`), keeping all blob history. For multi-hundred-GB code repositories this is rarely acceptable.

Recommended pattern: **maintain a bare mirror yourself on the server and let the scanner read it without cloning**. In the Scanner Source form, fill `Local repo path` and leave `Remote URL` blank:

```bash
# One-time mirror creation (slow the first time)
git clone --mirror https://github.com/big-org/giant-repo.git /srv/git-mirrors/giant-repo.git

# Keep it fresh (cron, every 5 minutes)
*/5 * * * * cd /srv/git-mirrors/giant-repo.git && git fetch --prune --quiet
```

Source configuration in the UI:

```text
Kind:            git
Local repo path: /srv/git-mirrors/giant-repo.git
Remote URL:      (leave blank)
```

When `repoPath` exists and `remoteUrl` is blank, the scanner runs `git log` / `git diff` directly against that path and never issues `git clone` / `git fetch` — no extra disk used. To shrink the mirror itself, add a partial-clone filter:

```bash
git clone --mirror --filter=blob:none https://github.com/big-org/giant-repo.git /srv/git-mirrors/giant-repo.git
```

`--filter=blob:none` keeps only commit and tree metadata; blobs are fetched on demand when computing diff content. Typical savings for code repos are 10–100x. Requires partial-clone support on the Git server (GitHub / GitLab / Gitea all support it).

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

- Scanner credentials (Git auth tokens, P4 passwords) are saved in the shared SQLite via Web UI `Settings → Scanner Sources` or the CLI `mindstrate-scan source add-*` commands, with the same handling as per-project LLM API keys. Do not move them back to env vars or commit them.
- Prefer environment variables for `TEAM_SERVER_URL` and `TEAM_API_KEY`; `TEAM_API_KEY` is the admin bootstrap key only — member keys are minted in the Web UI with project-scoped access.
- Custom collectors are trusted code; use declarative project rules for untrusted repositories.
- Keep scanner cursor DB separate from the Mindstrate knowledge DB.
