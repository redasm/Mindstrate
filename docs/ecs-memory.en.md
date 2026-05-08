# ECS Memory Architecture

Mindstrate uses an ECS-style context substrate: engineering experience is stored as graph nodes, relationships, events, projections, and metabolism records rather than as isolated text snippets only.

## What ECS Means Here

In this document, ECS means **Experience Context Substrate**. 

An Experience Context Substrate is a memory architecture where raw work experience is continuously captured, structured, compressed, related, and reused as working context. Instead of treating memory as a flat collection of notes or vector-search snippets, ECS models memory as a governed graph with lineage, provenance, confidence, conflicts, projections, and maintenance loops.

For Mindstrate, ECS means:

- experience becomes structured context rather than isolated text,
- context facts keep evidence and provenance,
- repeated experience can mature from episodes into rules or skills,
- stale or conflicting context is explicitly governed,
- agents receive assembled working context instead of manually stitching search results together.

## Positioning

Mindstrate keeps the useful parts of retrieval-backed memory while adding a graph-native context substrate. Search remains important, but the canonical structure is an evidence-backed context graph that can be queried, compressed, projected, and audited.

## Core Concepts

ECS memory separates two dimensions:

- `substrateType`: maturity in the compression lineage, such as episode, snapshot, summary, pattern, skill, rule, heuristic, or axiom.
- `domainType`: engineering meaning, such as bug fix, convention, workflow, architecture, troubleshooting, session summary, or project snapshot.

This lets the same engineering fact mature over time without losing its domain meaning.

## Graph Model

The main graph objects are context nodes and context edges. Nodes store content, quality, confidence, project scope, tags, status, compression level, and metadata. Edges store relationships such as follows, supports, contradicts, generalizes, instantiates, derived from, applies to, depends on, and observed in.

SQLite remains the canonical store. Vector indexes, Markdown files, Obsidian pages, and bundle folders are projections or acceleration layers, not independent facts.

## Metabolism Loop

The memory metabolism loop is:

```text
Digest -> Assimilate -> Compress -> Prune -> Reflect
```

Digest normalizes raw events into episodes. Assimilate groups events into snapshots and relationships. Compress promotes repeated or high-value context into summaries, patterns, skills, or rules. Prune archives or deprecates low-value context. Reflect handles conflicts and creates auditable correction candidates.

## Context Assembly

Agents should not manually stitch together sessions, snapshots, search results, and warnings. Context assembly should produce a working-context package containing session continuity, project substrate, relevant patterns, applicable rules, active warnings, known conflicts, evidence trails, and a bounded summary.

## Projections

Projection targets include graph knowledge views, session summaries, project snapshots, Obsidian documents, agent guidance, system prompt fragments, and fine-tune dataset candidates. Projections must be traceable to graph nodes and should not silently become competing sources of truth.

## Bundles

Portable context bundles allow stable memory slices to move between projects or teams. Bundles should include nodes, edges, rules, skills, evidence, and validation metadata. Installing a bundle should create audited graph entries rather than bypassing governance.

## Governance

High-risk automated changes should stay suggestive by default. Deprecation, archive, conflict resolution, and internalization need audit metadata. Conflicted or ambiguous knowledge should be visible but not silently promoted into normal working context.
