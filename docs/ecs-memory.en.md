# ECS Memory Architecture

In Mindstrate, ECS means **Evolvable Context Substrate**. It is not Entity Component System from game engines. It is a long-term memory paradigm for AI agents: memory is not a static retrieval table and not an endlessly growing pile of files, but a metabolizing lineage of compressed experience.

The core claim is: new engineering experience enters the system in low-compression form, then matures through usage, feedback, and pattern recognition into higher-compression forms. Low-value, stale, or conflicting memory is down-ranked, archived, corrected, or forgotten.

```text
Episode -> Snapshot -> Summary -> Pattern -> Skill -> Rule -> Heuristic -> Axiom
```

## Why ECS Exists

Most agent memory systems fall into two broad camps:

- **Memory Backends**: vector, graph, or hybrid retrieval systems that extract facts from conversations and events. They answer “what should be retrieved?”
- **Context Substrates**: structured files, project notes, or readable context surfaces that compound over time. They answer “what context should the agent work inside?”

Both are useful, but neither fully handles the memory lifecycle: absorption, assimilation, compression, promotion, forgetting, and conflict reflection. ECS puts retrieval, context assembly, skill formation, and memory governance into one evolvable system.

## Difference From Existing Paradigms

| Dimension | Memory Backends | Context Substrates | Mindstrate ECS |
| --- | --- | --- | --- |
| Core operation | Retrieval | Accumulation | Metabolism |
| Memory shape | Static entries | Structured files | Dynamic compression lineage |
| Time direction | Backward recall | Forward accumulation | Bidirectional flow |
| Knowledge evolution | Weak | Weak to medium | Explicit compression and promotion |
| Memory and skill | Separate | Usually separate | One spectrum |
| Forgetting | Manual deletion | Archive or ignore | Active governance |
| Canonical store | Vector or graph DB | Files | Evidence-backed context graph |

ECS does not reject retrieval. Retrieval remains an important access path, but it is not the whole memory system. Mindstrate uses the SQLite context graph as the canonical store; vector indexes, Markdown, Obsidian pages, bundle folders, and prompt fragments are projections or acceleration layers.

## Four-Layer Architecture

### Layer 1: Memory Type Lineage

ECS treats memory, skill, and rule as different maturity levels in one compression spectrum rather than separate systems. Eight substrate types span the full lineage, each with an explicit priority weight used during context assembly:

| Substrate | Priority | Meaning |
| --- | --- | --- |
| `episode` | 0.30 | Low-compression raw work fragment (a bug fix, a failed test, a session observation). |
| `snapshot` | 0.45 | Structured state for a project or session at a point in time. |
| `summary` | 0.62 | Bounded compression over multiple episodes. |
| `pattern` | 0.72 | Recurring engineering pattern, risk, or convention. |
| `skill` | 0.82 | Reusable procedure (“how to diagnose a flaky test”, “how to deploy Team Server”). |
| `rule` | 0.90 | High-compression executable constraint (“do not add flat proxy methods to the Mindstrate facade”). |
| `heuristic` | 0.95 | Stable judgment shortcut backed by multiple rules. |
| `axiom` | 1.00 | Project-level invariant that everything else must respect. |

Mindstrate represents memory with two orthogonal dimensions:

- `substrateType`: maturity in the compression lineage (the table above).
- `domainType`: engineering meaning. Twelve domain types are implemented: `bug_fix`, `best_practice`, `architecture`, `convention`, `pattern`, `troubleshooting`, `gotcha`, `how_to`, `workflow`, `project_snapshot`, `session_summary`, `context_event`.

This lets the same engineering fact mature over time without losing its domain meaning. A `bug_fix` can start as an `episode` and later promote to a `pattern` while staying a `bug_fix`.

### Layer 2: Declarative Context Graph

The core ECS data structure is an evidence-backed context graph. The main objects are context nodes and context edges.

Nodes store content, quality, confidence, project scope, tags, status, compression level, source reference, evidence-bearing metadata, and an auto-incremented `graphVersion`. Edges store relationships chosen from ten relation types:

| Relation | Semantics |
| --- | --- |
| `follows` | Temporal or causal sequence between two events. |
| `causes` | One node is the cause of another. |
| `supports` | A piece of evidence reinforces a higher-substrate node. |
| `contradicts` | Two nodes encode incompatible claims; triggers conflict detection. |
| `generalizes` | A higher-substrate node abstracts a lower one. |
| `instantiates` | A specific case of a more general pattern / rule. |
| `derived_from` | A compressor produced this node from sources. |
| `applies_to` | A rule / skill applies to a target node (file, module, dependency). |
| `depends_on` | Build / runtime dependency captured from the project graph. |
| `observed_in` | An episode was first seen during a specific event or session. |

The project graph is also part of this context graph: files, dependencies, components, calls, bindings, asset references, and risk hints all keep evidence paths under `metadata.evidence[].path`. Agents receive a traceable, queryable, auditable working substrate rather than unsourced notes.

Node status forms an explicit lifecycle (`candidate -> active -> verified`, plus `archived` and `conflicted`), so governance decisions are first-class data rather than implicit flags.

### Layer 3: Memory Metabolism Engine

The memory metabolism loop is:

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

- `Digest`: normalize raw events into episodes. Five dedicated ingestors handle Git activity, test runs, LSP diagnostics, terminal output, and user feedback, on top of generic session observation ingestion.
- `Assimilate`: group episodes into snapshots, relationships, and project facts.
- `Compress`: promote repeated or high-value context into summaries, patterns, skills, or rules. Six cooperating compressors do this work: `summary`, `pattern`, `rule`, `high-order`, `feedback-cooccurrence`, and the shared `substrate` compression primitive that powers them.
- `Prune`: archive, down-rank, or discard low-value, stale, duplicate, or disproven context. Prune emits suggestions (`merge`, `archive`, `validate`, `improve`, `split`); each suggestion type has its own auto-apply confidence threshold so risky moves stay in `pendingReview`.
- `Reflect`: handle conflicts and create auditable correction candidates so wrong memory does not silently upgrade. Conflict detection uses embedding similarity plus explicit `contradicts` edges; reflection writes a `candidate` node and a paired audit event with `actor: "metabolism.reflect"`.

Metabolism turns memory from an append-only warehouse into a cognitive artifact that continuously maintains its own quality. Each run is persisted in a metabolism-run repository with per-stage stats so quality regressions are traceable, and a metabolism scheduler can drive it on a cadence.

### Layer 4: Internal-External Memory Coordination

Mindstrate separates canonical memory from projection.

- Internal memory: SQLite context graph, project graph facts, events, sessions, metabolism records.
- External projections, all of which carry a `sourceNodeId` (or equivalent) back to the canonical graph:
  - Obsidian documents under `<vault>/<project>/architecture/`.
  - Markdown reports such as `PROJECT_GRAPH.md` and project snapshots.
  - MCP resources surfaced by `@mindstrate/mcp-server`.
  - Agent guidance fragments materialized into `AGENTS.md`.
  - System prompt fragments for embedding into LLM tool definitions.
  - Portable context bundles for cross-project sharing.
  - Fine-tune dataset candidates emitted as JSONL with `sourceNodeId` per line.

External projections can be human-edited, reviewed, and shared, but they must not silently become competing sources of truth. Projections must trace back to graph nodes, edges, evidence, and audit metadata. External feedback flows back into the internal graph through ingestion or overlays (for example, `importProjectGraphOverlayBlock` reads user-edited blocks out of architecture pages back into the graph as overlay nodes).

## Context Assembly

Agents should not manually stitch together sessions, snapshots, search results, and warnings. Context assembly produces a bounded working-context package. The assembled context shape includes:

- `sessionContinuity` — recent session memory for continuity across calls.
- `projectSubstrate` — the active project snapshot and headline facts.
- `taskRelevantPatterns`, `applicableSkills`, `activeRules` — surface knowledge ranked by the substrate priority table above.
- `projectGraphContext` — file / module / dependency / asset facts pulled in via 1-hop project graph expansion seeded from `currentFile` plus task tokens.
- `warnings`, `knownConflicts` — risk surface.
- `evidenceTrail` — explicit evidence paths for every surfaced fact.
- `retrievals` — per-node retrieval tickets that the agent must report back via `memory_feedback_auto` so the priority selector learns which knowledge actually informed the answer.
- `summary` — the rendered Markdown the agent reads.

The ECS goal is not to stuff every related fact into the prompt. It is to assemble the smallest useful context for the current task and explain why each item is included, where the evidence is, and which risks remain.

## Bundles

Portable context bundles allow stable memory slices to move between projects or teams. Bundles include nodes, edges, rules, skills, evidence, and validation metadata. Six distinct paths are supported, all gated by `validateBundle` so installation cannot bypass governance:

- `createBundle` — slice a subgraph out of the canonical store.
- `validateBundle` — structural and referential integrity check.
- `installBundle` — install a payload directly; fails closed on validation errors.
- `publishBundle` — push a validated bundle to a registry.
- `installBundleFromRegistry` — fetch + install by registry reference.
- `installEditableBundleDirectory` — install a human-readable directory layout, useful for review-before-merge workflows.

Installing a bundle creates audited graph entries — node metadata is preserved verbatim so provenance survives the trip across projects.

## Governance Principles

- **High-risk automated changes stay suggestive by default.** The evolution engine has separate auto-apply confidence thresholds for `merge`, `archive`, and `validate` suggestions; anything below threshold goes into `pendingReview` instead of mutating the graph.
- **Deprecation, archive, conflict resolution, and internalization need audit metadata.** Every accept/reject in the conflict reflector writes a paired audit event, and the evolution engine stamps `metadata.evolutionAudit` on every applied suggestion. Nodes carry an auto-incremented `graphVersion` so retroactive forensics can reconstruct any change.
- **Conflicted or ambiguous knowledge stays visible but is not silently promoted into normal working context.** Conflicts surface as `candidate` nodes with status `conflicted`; only an explicit `accept` resolves them to `verified`.
- **LLM enrichment may enhance existing deterministic facts but must not replace parser-first evidence.** The project graph runs a tree-sitter source parser first; LLM enrichment is opt-in, runs second, and only writes additional metadata tagged `llmEnrichment: true`. Disabling the LLM still yields a complete deterministic graph.
- **Memory quality comes from long-term feedback, reuse, and compression, not from one-off summaries.** Every assembled retrieval mints a `retrievalId`; agents report back via `memory_feedback_auto`, and the feedback loop adjusts `positiveFeedback` / `negativeFeedback` on the source node. The priority selector then uses those counts in future assemblies.

## Implementation Status

These are the canonical entry points for the four layers above. Path references are relative to the monorepo root and stable to depend on for tooling.

| Concern | Entry point |
| --- | --- |
| Substrate / domain / status / relation / event enums | `packages/protocol/src/models/context-graph.ts` |
| Context node + edge repositories (SQLite) | `packages/server/src/context-graph/context-node-repository.ts`, `context-edge-repository.ts` |
| Metabolism orchestration | `packages/server/src/metabolism/metabolism-engine.ts` |
| Digest / assimilate / compress / prune / reflect stages | `packages/server/src/metabolism/{digest-engine,assimilator,compressor,pruner,reflector}.ts` |
| Compressors (summary / pattern / rule / high-order / feedback-cooccurrence) | `packages/server/src/context-graph/*-compressor.ts` |
| Conflict detection + reflection | `packages/server/src/context-graph/conflict-detector.ts`, `conflict-reflector.ts` |
| Event ingestors (Git / test / LSP / terminal / user feedback) | `packages/server/src/events/event-ingestors.ts` |
| Context assembly DAG | `packages/server/src/context-graph/context-assembly-dag.ts` |
| Priority selection with embedding similarity | `packages/server/src/context-graph/context-priority-selector.ts` |
| Internalization to AGENTS.md / project snapshot / system prompt / fine-tune JSONL | `packages/server/src/context-graph/context-internalizer.ts` |
| Portable context bundles | `packages/server/src/bundles/portable-context-bundle.ts` |
| Obsidian projection (architecture pages → RULE nodes) | `packages/server/src/project-graph/internalize-system-pages.ts` |
| MCP tool surface | `packages/mcp-server/src/tools/` |

For deeper architectural context, see [`architecture.en.md`](architecture.en.md) and [`project-graph.en.md`](project-graph.en.md).
