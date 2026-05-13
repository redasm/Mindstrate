# System Pages — Customizing Project Architecture Documentation

Mindstrate generates a small set of architecture pages under
`<vault>/<project>/architecture/` whenever you run `mindstrate setup`,
`mindstrate init` (with `--with-vault`), or `mindstrate graph sync`.
These pages serve two consumers:

1. **Humans** browsing the Obsidian vault, who want a high-value entry
   point for the project before drilling into raw graph nodes.
2. **AI agents** through MCP retrieval (`context_assemble`,
   `query_project_graph_task before-edit | impact`,
   `search_graph_knowledge`), which read the same pages as
   `RULE + ARCHITECTURE` nodes internalized by
   `internalize-system-pages.ts`.

Pages are composed from **three layers**, low → high priority. A page
key (e.g. `00-overview`) wins at the highest layer that defines it.

## Layer 1 — Generic skeleton (built-in, always written)

Source: `packages/server/src/project-graph/obsidian-system-pages-generic.ts`.

The skeleton is **language-agnostic** and only uses fields the project
detector already populated (`language`, `framework`, `packageManager`,
`entryPoints`, `scripts`, `topDirs`, `manifestPath`, `workspaces`). It
ships three pages:

| Key                     | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `00-overview`           | Project name, framework, language, top-level layout.  |
| `01-entry-and-scripts`  | Detected entry points and `package.json` scripts.     |
| `02-validation-playbook`| Validation policy and any detected `test/build/lint`. |

The skeleton never names a stack (no `UCLASS`, no `pyproject.toml`, no
`Cargo.toml`). A project the detector has never seen still gets a
useful starter page.

## Layer 2 — Stack architecture preset (from a detection rule)

Source: a **JSON include file** referenced from a detection rule via
`"systemPagesInclude"`.

A detection rule can ship a complete architecture book by adding:

```json
{
  "id": "unreal-project",
  "systemPagesInclude": "unreal-architecture-pages.json",
  "match": { "all": [{ "glob": "*.uproject" }, { "dir": "Content" }, { "dir": "Config" }] }
}
```

The include file lives next to the rule and has the shape:

```json
{
  "en": [ { "key": "00-overview", ... }, { "key": "01-runtime-lifecycle", ... } ],
  "zh": [ { "key": "00-overview", ... }, ... ]
}
```

Each entry follows the `RuleSystemPagePreset` shape (see
`packages/server/src/project/detector.ts`):

| Field                  | Required | Notes                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------- |
| `key`                  | yes      | Stable id. Same key overrides Layer 1.                                             |
| `name`                 | yes      | On-disk filename (`02-cpp-typescript-bridge.md`).                                  |
| `title`                | yes      | Markdown `# H1`. Supports `${project.name}` / `${project.framework}` / `${project.language}` tokens. |
| `body`                 | yes      | Array of Markdown lines. Supports two placeholder lines: see "Body templating".    |
| `overlays`             | yes      | YAML overlay block lines (kind/risk/correction/...).                               |
| `userNotesTitle`       | yes      | Section header for the user-editable notes block.                                  |
| `userNotesPlaceholder` | yes      | Default body for the user-editable notes block.                                    |
| `overlayTitle`         | yes      | Section header for the structured overlay block.                                   |
| `metadata`             | no       | Drives MCP `before-edit` / `impact` reports. See "Metadata fields".                |

When the active locale is `zh` but the include file only ships `en`
(or vice versa), the alternate locale is used as a fallback. This
means a stack preset can grow into a second locale incrementally.

### Body templating

Two declarative placeholders are expanded at render time so the JSON
preset stays free of runtime data:

| Placeholder line                              | Replaced by                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `<!-- mindstrate:operation-manual -->`        | `renderProjectOperationManualSections(project)` — empty when the rule has no `operationManual`.            |
| `<!-- mindstrate:generated-roots -->`         | A bullet list of `project.graphHints.generatedRoots`, or `- (no generated roots declared)` when empty.     |

Token expansion is also applied to `title` and any non-placeholder
`body` line:

- `${project.name}` → `project.name`
- `${project.framework}` → `project.framework ?? 'unknown'`
- `${project.language}` → `project.language ?? 'unknown'`

### Metadata fields

`metadata` makes the page contribute to MCP task reports. See
`SystemPageClassification` for the full list of valid `classifications`
values; any `classifications` entry not in the canonical list is
silently dropped at load time.

| Field                     | Used by `before-edit` / `impact` to populate           |
| ------------------------- | ------------------------------------------------------ |
| `classifications`         | Selecting which target categories this page applies to.|
| `knownConstraints`        | "### Known Constraints" lines.                         |
| `doNotEditTargets`        | "### Do Not Edit Directly" lines.                      |
| `affectedChain`           | "### Affected Chains" line.                            |
| `sourceOfTruth`           | "### Source Of Truth" lines.                           |
| `recommendedVerification` | "### Recommended Verification" lines.                  |
| `tags`                    | Free-form tags appended to the internalized RULE node. |

A page with **no `classifications`** behaves as a global overlay: its
`recommendedVerification` lines are appended to every `before-edit`
report regardless of target classification. The other metadata fields
on a global page are ignored to avoid drowning out targeted guidance.

## Layer 3 — Custom user pages (per project)

Source: `<project-root>/.mindstrate/system-pages/*.json`.

Drop one JSON file per page. Each file has the same shape as one
`RuleSystemPagePreset` entry above, except the locale wrapper is gone:

```json
{
  "key": "10-combat",
  "name": "10-combat.md",
  "title": "Combat System",
  "body": ["## Purpose", "", "- Authoritative combat layer."],
  "overlays": [],
  "userNotesPlaceholder": "- Add combat-specific corrections here.",
  "userNotesTitle": "User Notes",
  "overlayTitle": "Structured Overlay",
  "metadata": {
    "classifications": ["combat-system"],
    "knownConstraints": ["GAS attribute sets are generated; do not edit."]
  }
}
```

Custom pages always win when the same `key` exists at Layer 1 or 2.
The CLI helper `mindstrate system-pages init <key>` scaffolds the JSON
template for you, including comments and a `_help` block, so you do
not have to memorize the shape.

The `<project-root>/.mindstrate/system-pages/` directory itself is
versioned with the project (commit it to the repo), so the team
shares the same custom pages.

## Worked example — adding a new stack preset

Suppose you maintain a Rust crate and want every Mindstrate user who
opens it to receive Cargo / wasm / no_std flavored architecture pages.

1. **Author the include file** alongside the existing detection rules:

   `packages/server/src/project/rules/rust-architecture-pages.json`

   ```json
   {
     "en": [
       {
         "key": "00-overview",
         "name": "00-overview.md",
         "title": "${project.name} Architecture Overview",
         "body": [
           "## Purpose",
           "",
           "- Crate entry point for human readers.",
           "- Framework: ${project.framework}.",
           "- Primary language: ${project.language}."
         ],
         "overlays": [],
         "userNotesPlaceholder": "- Confirm crate ownership here.",
         "userNotesTitle": "User Notes",
         "overlayTitle": "Structured Overlay"
       },
       {
         "key": "10-cargo-features",
         "name": "10-cargo-features.md",
         "title": "Cargo Features and Targets",
         "body": [
           "## Features",
           "",
           "- Document feature flags here.",
           "",
           "## Targets",
           "",
           "- Document supported `--target` triples here."
         ],
         "overlays": [],
         "userNotesPlaceholder": "- Confirm enabled features here.",
         "userNotesTitle": "User Notes",
         "overlayTitle": "Structured Overlay",
         "metadata": {
           "classifications": ["build-module"],
           "knownConstraints": [
             "Adding a feature requires updating downstream consumers' Cargo.toml."
           ]
         }
       }
     ],
     "zh": [ /* mirror the en entries with translated text */ ]
   }
   ```

2. **Reference it from the rule** (e.g. `rust-project.json`):

   ```json
   { "id": "rust-project", "systemPagesInclude": "rust-architecture-pages.json", ... }
   ```

3. **Run `mindstrate setup`** in any Rust project. The skeleton's
   `00-overview` is replaced by the rule's; `10-cargo-features.md`
   shows up as a brand-new page.

## Worked example — overriding one Unreal page in your project

You ship an Unreal project that owns a custom `02-cpp-typescript-bridge`
contract different from the built-in description.

```bash
mkdir -p .mindstrate/system-pages
cat > .mindstrate/system-pages/02-cpp-typescript-bridge.json <<'JSON'
{
  "key": "02-cpp-typescript-bridge",
  "name": "02-cpp-typescript-bridge.md",
  "title": "C++ <-> TS Bridge (Project-specific)",
  "body": [
    "## Source Of Truth",
    "",
    "- Always edit `Source/MyGame/Public/Reflect/*.h`; never the generated `.ts`."
  ],
  "overlays": [],
  "userNotesPlaceholder": "- Add per-feature overrides here.",
  "userNotesTitle": "User Notes",
  "overlayTitle": "Structured Overlay",
  "metadata": {
    "classifications": ["native-script-binding"],
    "knownConstraints": [
      "MyGame's reflection lives under Public/Reflect/ specifically."
    ]
  }
}
JSON
```

Re-run `mindstrate setup`. The page replaces the Unreal preset's
default `02-cpp-typescript-bridge.md` for this project only; everyone
else still gets the standard one.

## Inspecting what is active

```bash
# List the architecture pages a particular project would receive,
# grouped by their source layer.
mindstrate system-pages list

# Scaffold a new custom page from a key the rule layer suggested.
mindstrate system-pages init 10-combat
```

The `list` output groups entries as `[skeleton]`, `[rule:<rule-id>]`,
or `[custom:<filename>]`, so you can tell at a glance which page is
overriding which.

## Internalization into the ECS graph

Every page that survives the layered merge is internalized as a
deterministic `RULE + ARCHITECTURE` node with id
`architecture:system-page:<project>:<page-key>`. The node's metadata
mirrors the page's `metadata` block, so MCP retrieval surfaces
page-level constraints without having to parse the rendered Markdown.

This step is fully automatic during `setup` / `graph sync`. See
`internalize-system-pages.ts` for the exact mapping.
