# Project Detection Rules

## Goal

Mindstrate should not rely only on hard-coded project detectors. Standard
language detectors cover Node, Python, Rust, and Go, but real teams often work
with Unreal, Unity, Godot, mobile apps, monorepos, or internal engines. When a
project type is unknown, the current snapshot falls back to a shallow directory
list, which is not enough for AI agents to understand project boundaries.

Project Detection Rules make project understanding extensible:

- Mindstrate ships core built-in rules as JSON files.
- Users can add project-local rules.
- Teams can share organization-specific rules.
- Snapshot generation can include domain-specific guidance without changing
  Mindstrate core code.

## Current Loading Order

Rules are loaded in priority order, with project-local rules overriding generic
built-ins when priorities are equal:

1. Project-local rules: `.mindstrate/rules/*.json`
2. Built-in rules packaged with Mindstrate under `packages/server/src/project/rules/*.json`

When multiple rules match, the highest `priority` wins. If priorities are equal,
project-local rules win over built-in rules.

User-global and Team Server distributed rules are not implemented yet. Prefer
committing project-local rules when a repository needs custom detection.

## Rule Format

Rules are declarative JSON only. Mindstrate does not execute user JavaScript or
TypeScript during project detection.

Example Unreal rule:

```json
{
  "id": "unreal-project",
  "name": "Unreal Engine Project",
  "priority": 90,
  "match": {
    "all": [
      { "glob": "*.uproject" },
      { "dir": "Content" },
      { "dir": "Config" }
    ],
    "any": [
      { "dir": "Source" },
      { "dir": "Plugins" }
    ]
  },
  "detect": {
    "language": "cpp",
    "framework": "unreal-engine",
    "packageManager": "unreal",
    "manifest": "*.uproject",
    "entryPoints": [
      "Source/**/*.Build.cs",
      "Source/**/*.Target.cs"
    ],
    "topDirs": {
      "Source": "C++ gameplay/client/server modules.",
      "Content": "Unreal assets and maps.",
      "Config": "Engine/game/project configuration.",
      "Plugins": "Project plugins and third-party extensions.",
      "Binaries": "Generated build output; do not edit manually.",
      "Intermediate": "Generated build intermediates; do not edit manually.",
      "Saved": "Local/editor generated state; do not edit manually.",
      "DerivedDataCache": "Generated asset cache; do not edit manually.",
      "SoundBanks": "Audio middleware generated assets, often Wwise."
    }
  },
  "snapshot": {
    "overview": "This appears to be an Unreal Engine project.",
    "invariants": [
      "Do not edit Binaries, Intermediate, Saved, or DerivedDataCache unless explicitly requested.",
      "Prefer source, config, or plugin edits over generated output.",
      "Asset references may be path-sensitive; validate renames through Unreal-aware tooling."
    ],
    "conventions": [
      "Treat .uproject as the project manifest.",
      "Treat *.Build.cs and *.Target.cs as module/build entry points."
    ]
  }
}
```

## Match Operators

MVP match operators:

- `file`: exact relative file path exists.
- `dir`: exact relative directory path exists.
- `glob`: glob relative to project root.
- `readmeContains`: README excerpt contains text.
- `jsonPath`: manifest JSON contains a key/path.
- `tomlKey`: manifest TOML contains a key.
- `packageDependency`: package manifest includes dependency name.

Rules may define:

- `all`: every condition must match.
- `any`: at least one condition must match.
- `none`: no condition may match.

## Snapshot Enrichment

Rules should be able to enrich the project snapshot without overwriting user
preserved sections.

Supported enrichment fields:

- `snapshot.overview`
- `snapshot.invariants`
- `snapshot.conventions`
- `detect.topDirs` descriptions
- `detect.entryPoints`
- `detect.framework`
- `detect.language`
- `detect.packageManager`
- `detect.manifest`

The renderer should keep generated rule content outside preserve blocks. User
notes still live inside existing preserve blocks and must survive re-runs.

## Security Boundary

MVP rules are data, not code. Mindstrate should validate rule JSON before use.

Avoid in MVP:

- Executing arbitrary JavaScript or TypeScript detectors.
- Running shell commands from rules.
- Reading files outside the project root.
- Network access from project detection.

Future advanced detector plugins may be allowed behind an explicit flag such as
`--allow-rule-code`, but this should be opt-in and documented as unsafe for
untrusted repositories.

## CLI UX

`mindstrate setup` and `mindstrate init` use matching rules automatically. A
future dedicated `mindstrate rules` command can expose validation and listing.

Setup output should make the detected project clear:

```text
Project detection:
  Matched rule: Unreal Engine Project (project-local)
  Framework:    unreal-engine
  Manifest:     MyGame.uproject
```

## Non-Goals

- Full AST/code graph extraction.
- LLM-generated architecture summaries.
- Running user-provided detector code.
- Team Server rule distribution.

For user-facing configuration examples, see [Project Configuration](project-configuration.md).
