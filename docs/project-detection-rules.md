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

## Loading Order

Rules should be loaded in priority order, with more specific sources overriding
generic built-ins:

1. Project-local rules: `.mindstrate/rules/*.json`
2. User-global rules: `~/.mindstrate/rules/project-detection/*.json`
3. Team-provided rules, when running in team mode
4. Built-in rules packaged with Mindstrate under `packages/server/src/project/rules/*.json`

When multiple rules match, the highest `priority` wins. If priorities are equal,
project-local rules win over global/team/built-in rules.

## Rule Format

MVP rules should be declarative JSON only. Do not execute user JavaScript or
TypeScript in the first version.

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

Possible commands:

```bash
mindstrate rules list
mindstrate rules validate .mindstrate/rules/unreal.json
mindstrate rules doctor
mindstrate setup
```

`mindstrate setup` should show which rule matched:

```text
Project detection:
  Matched rule: Unreal Engine Project (project-local)
  Framework:    unreal-engine
  Manifest:     MyGame.uproject
```

## MVP Implementation Plan

1. Add `ProjectDetectionRule` types and validation.
2. Add a shared JSON rule loader for project-local and built-in rules.
3. Add built-in `unreal-project` as `packages/server/src/project/rules/unreal-project.json`.
4. Update `detectProject()` to run rule detectors before generic fallback.
5. Extend `DetectedProject` with rule-derived descriptions and snapshot hints.
6. Update snapshot renderer to include rule-derived overview, directory notes,
   invariants, and conventions.
7. Add tests for:
   - Unreal rule matching.
   - Project-local rule priority over built-ins.
   - Invalid rule rejection.
   - Snapshot preserve blocks surviving rule re-runs.

## Non-Goals For MVP

- Full AST/code graph extraction.
- LLM-generated architecture summaries.
- Running user-provided detector code.
- Team Server rule distribution.

Those can come later after declarative rule loading is stable.
