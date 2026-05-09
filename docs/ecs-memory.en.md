# ECS Memory Architecture

In Mindstrate, ECS means **Evolvable Context Substrate**. It is not Entity Component System from game engines. It is a long-term memory paradigm for AI agents: memory is not a static retrieval table and not an endlessly growing pile of files, but a metabolizing lineage of compressed experience.

The core claim is: new engineering experience enters the system in low-compression form, then matures through usage, feedback, and pattern recognition into higher-compression forms. Low-value, stale, or conflicting memory is down-ranked, archived, corrected, or forgotten.

```text
Episode -> Snapshot -> Summary -> Pattern -> Skill -> Rule
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

ECS treats memory, skill, and rule as different maturity levels in one compression spectrum rather than separate systems.

- `episode`: low-compression raw work fragments, such as a bug fix, failed test, or session observation.
- `snapshot`: structured state for a project or session at a point in time.
- `summary`: bounded compression over multiple episodes.
- `pattern`: recurring engineering pattern, risk, or convention.
- `skill`: reusable procedure, such as “how to diagnose a flaky test” or “how to deploy Team Server”.
- `rule`: high-compression executable constraint, such as “do not add flat proxy methods to the Mindstrate facade”.

Mindstrate represents memory with two dimensions:

- `substrateType`: maturity in the experience compression lineage, such as episode, snapshot, summary, pattern, skill, rule, heuristic, or axiom.
- `domainType`: engineering meaning, such as bug fix, convention, workflow, architecture, troubleshooting, session summary, or project snapshot.

This lets the same engineering fact mature over time without losing domain meaning.

### Layer 2: Declarative Context Graph

The core ECS data structure is an evidence-backed context graph. The main objects are context nodes and context edges.

Nodes store content, quality, confidence, project scope, tags, status, compression level, and metadata. Edges store relationships such as `follows`, `supports`, `contradicts`, `generalizes`, `instantiates`, `derived from`, `applies to`, `depends on`, and `observed in`.

The project graph is also part of this context graph: files, dependencies, components, calls, bindings, asset references, and risk hints all keep evidence paths. Agents receive a traceable, queryable, auditable working substrate rather than unsourced notes.

### Layer 3: Memory Metabolism Engine

The memory metabolism loop is:

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

- `Digest`: normalize raw events into episodes, including Git, tests, LSP, terminal output, user feedback, and session observations.
- `Assimilate`: group episodes into snapshots, relationships, and project facts.
- `Compress`: promote repeated or high-value context into summaries, patterns, skills, or rules.
- `Prune`: archive, down-rank, or discard low-value, stale, duplicate, or disproven context.
- `Reflect`: handle conflicts and create auditable correction candidates so wrong memory does not silently upgrade.

Metabolism turns memory from an append-only warehouse into a cognitive artifact that continuously maintains its own quality.

### Layer 4: Internal-External Memory Coordination

Mindstrate separates canonical memory from projection.

- Internal memory: SQLite context graph, project graph facts, events, sessions, metabolism records.
- External projections: Obsidian documents, Markdown reports, MCP resources, agent guidance, system prompt fragments, portable bundles, fine-tune dataset candidates.

External projections can be human-edited, reviewed, and shared, but they must not silently become competing sources of truth. Projections must trace back to graph nodes, edges, evidence, and audit metadata. External feedback flows back into the internal graph through ingestion or overlays.

## Context Assembly

Agents should not manually stitch together sessions, snapshots, search results, and warnings. Context assembly should produce a bounded working-context package containing session continuity, project substrate, relevant patterns, applicable rules, active warnings, known conflicts, evidence trails, and a summary.

The ECS goal is not to stuff every related fact into the prompt. It is to assemble the smallest useful context for the current task and explain why each item is included, where the evidence is, and which risks remain.

## Bundles

Portable context bundles allow stable memory slices to move between projects or teams. Bundles should include nodes, edges, rules, skills, evidence, and validation metadata. Installing a bundle should create audited graph entries rather than bypassing governance.

## Governance Principles

- High-risk automated changes should stay suggestive by default.
- Deprecation, archive, conflict resolution, and internalization need audit metadata.
- Conflicted or ambiguous knowledge should be visible but not silently promoted into normal working context.
- LLM enrichment may enhance existing deterministic facts but must not replace parser-first evidence.
- Memory quality comes from long-term feedback, reuse, and compression, not from one-off summaries.
