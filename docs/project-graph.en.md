# Project Graph

Mindstrate Project Graph turns a repository into evidence-backed graph context for humans and AI agents. It is built from parser and structured extraction first, with optional LLM enrichment only after deterministic facts exist.

## Goals

The project graph should answer practical engineering questions:

- What are the important files, modules, components, and entry points?
- Which dependencies and configs shape runtime behavior?
- Which files are generated or risky to edit?
- What is the likely blast radius of a change?
- Which evidence supports each conclusion?

## Pipeline

The graph pipeline follows these stages:

```text
detect project -> scan files -> extract facts -> build graph -> analyze -> report/project
```

Detection uses declarative project rules. Scanning respects ignored, generated, dependency, and metadata-only paths. Extraction uses tree-sitter query packs, framework-specific parsers, manifests, configs, and asset metadata where available. Graph facts are written with stable node IDs, edge IDs, provenance, and evidence paths.

## Parser-First Policy

Source facts should come from deterministic extraction, not LLM guesses. Tree-sitter query packs are the default direction for source languages. Structured formats use structured parsers. Regex fallback is allowed only for small stable patterns or until a language has a compatible parser adapter.

Current source parser coverage includes TypeScript, TSX, JavaScript, JSX, Python, C#, and C++ through tree-sitter query packs. Lua remains on regex fallback until a compatible grammar/runtime path is available.

## Provenance

Project graph data distinguishes:

- `EXTRACTED`: directly observed from source, manifests, config, or metadata.
- `INFERRED`: derived from LLM or heuristic enrichment.
- `AMBIGUOUS`: plausible but uncertain and should be verified.

Reports and graph queries should preserve evidence paths so agents can inspect source before editing.

## Outputs

Mindstrate can write:

- `PROJECT_GRAPH.md` style reports,
- machine-readable graph artifacts under `.mindstrate/`,
- Obsidian architecture projections,
- node, module, flow, and binding pages,
- CLI and MCP query responses with bounded subgraphs.

The graph is an index and guide, not a substitute for source review.

## Query Surface

Important operations include graph search, node lookup, neighbor expansion, shortest path, blast radius, task-oriented queries, report generation, and change impact analysis. MCP tools should return focused context instead of dumping the full graph.

In team mode, the Web UI renders the same graph in the browser — nodes, dependencies, risk metadata, before-edit reports, and member-authored structured overlays can all be browsed and edited directly.

![Web UI project graph view](images/project_graph.jpg)

## Privacy Boundary

Parser facts are extracted locally. LLM enrichment is optional and should receive bounded evidence snippets rather than unrestricted source by default. LLM-created content must be labeled as inferred or ambiguous.

## Evaluation

Project graph quality should be evaluated with fixtures and task prompts. Useful graph output should improve file selection, architecture answers, generated-code avoidance, impact prediction, and evidence citation.
