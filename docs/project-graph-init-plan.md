# Project Graph Init Plan

## Goal

`mindstrate init` should produce useful project understanding by default. A
basic metadata snapshot is not enough for either humans or AI agents: knowing
that a project is "React" or "Unreal" does not explain the important modules,
ownership boundaries, entry flows, dependencies, or change risks.

The new default should be a parser-first project graph analysis pipeline that
uses tree-sitter as the primary source-code parsing substrate and combines the
strongest ideas from Graphify v5 and GitNexus:

- Use parser-based extraction for source facts, with tree-sitter query packs as
  the default path for code languages.
- Use specialized structured parsers for manifests, config files, docs, and
  framework formats where tree-sitter is not the right tool.
- Use rule packs to choose project-specific extraction strategy.
- Provide query/context/impact tools instead of dumping a full graph into LLM
  context.
- Use optional LLM analysis for summaries and inferred relationships.
- Store facts and inferences in Mindstrate's context graph.
- Export AI-readable reports to Obsidian and local files.

Rules identify project shape and select extraction strategy. Tree-sitter query
packs and structured parsers discover facts. LLMs explain and connect those
facts. The system should not ask an LLM to guess what a parser can prove.

Graphify contributes the provenance/report model. GitNexus contributes the
product shape: precomputed code intelligence exposed through CLI and MCP tools
such as context, impact, change detection, and graph exploration.

## Product Positioning

`mindstrate init` becomes "build the first useful project knowledge graph".

There should not be a low-quality quick mode. If the graph is too shallow to
help an AI agent understand the project, it should not be the default or an
advertised path.

LLM usage should be automatic:

- If an LLM provider is configured, `init` uses it after deterministic parser
  extraction.
- If no LLM provider is configured, `init` still builds the deterministic graph
  and skips inferred summaries.

`mindstrate init` should also be idempotent. On an existing project, it refreshes
the graph incrementally instead of requiring a separate command.

The setup wizard should make the cost/time tradeoff explicit, but it should not
push users toward a low-value quick snapshot.

## User Experience

During setup or init, show a step-by-step progress view:

```text
Analyzing project

[######----] 60%  Extracting TypeScript imports
Files scanned: 1,284
Nodes: 3,912
Edges: 7,440
Elapsed: 38s
Current: src/features/auth/session.ts
```

For large repositories, show estimated scope before starting:

- files to scan
- ignored directories
- whether a configured LLM provider will be used
- approximate token/cost warning when available

## Pipeline

### 1. Detect

Use existing JSON project detection rules to identify:

- project type and framework
- manifests
- generated directories to ignore
- source roots
- project-specific parser, query pack, and convention hints

Rules remain declarative JSON. They select strategies; they do not execute code.
For example, a React rule can select TypeScript/TSX tree-sitter query packs and
React conventions, while an Unreal rule can select `.uproject`, `*.Build.cs`,
config parsers, and C++/C# query packs when available.

Rules are a routing and boundary layer, not the knowledge layer. They should not
be treated as the main source of project understanding. Their job is to tell the
scanner what kind of project this is, which parser adapters, query packs, and
convention extractors to run, where source code lives, and which generated or
dangerous directories to avoid.

### 2. Scan

Build a project file inventory:

- Respect `.gitignore`, `.mindstrateignore`, and rule-provided ignore dirs.
- Ignore generated and dependency directories by default.
- Record path, size, extension, hash, modified time, and language.
- Cache file hashes for incremental refresh.

### 3. Extract Facts With Parser Adapters

Run deterministic parser adapters before any LLM step. Facts extracted from
tree-sitter parse trees, structured manifests, config files, framework parsers,
and documentation parsers should be marked as `EXTRACTED`.

LLMs must not create source facts such as imports, exports, functions, routes,
or package dependencies. They may only summarize or infer relationships from
already extracted evidence.

Initial parser adapters, query packs, and convention extractors:

- Tree-sitter source parser:
  - TypeScript, TSX, JavaScript, and JSX grammar support
  - language-specific query packs instead of hand-written whole-language AST
    walkers
  - static imports and exports
  - dynamic imports when statically resolvable
  - top-level functions, classes, interfaces, types, and enums
  - React component declarations
  - React hooks usage
  - route handler exports when detectable
  - Next/Nuxt route files
  - Vite config and bootstrap entry points
- Package manifest parser:
  - package dependencies
  - scripts
  - package manager and workspace metadata
- Vue SFC parser:
  - `<script>` and `<script setup>` extraction for downstream source parsing
  - props and emits
  - component name
  - template component references when cheap to extract
- Unreal/C++:
  - `.uproject`
  - `*.Build.cs`
  - `*.Target.cs`
  - Unreal modules and dependencies from structured manifest/build parsing or
    query packs
  - config files
  - generated directories to avoid
- Markdown/docs:
  - markdown parser headings
  - ADR-like documents
  - "why", "decision", "constraint", "todo", "note", "warning" sections
- Generic config:
  - package manifests
  - build/test config files
  - environment template files

### 4. Build Graph

Write extracted knowledge into Mindstrate context graph.

Suggested node types:

- `project`
- `directory`
- `file`
- `module`
- `component`
- `route`
- `config`
- `script`
- `dependency`
- `function`
- `class`
- `type`
- `concept`
- `decision`
- `constraint`
- `risk`

Suggested edge types:

- `contains`
- `imports`
- `exports`
- `depends_on`
- `defines`
- `configures`
- `routes_to`
- `renders`
- `calls`
- `uses_hook`
- `documents`
- `constrains`
- `rationale_for`
- `related_to`

Every edge should carry provenance:

- `EXTRACTED`: directly observed from source/config/docs.
- `INFERRED`: generated by LLM or heuristic reasoning.
- `AMBIGUOUS`: plausible but uncertain; should be confirmed by user or later
  evidence.

### 5. Analyze Semantics

LLM analysis runs when the user has configured a provider. If no provider is
configured, the pipeline skips this step and keeps the deterministic graph.

LLM analysis consumes graph facts and selected evidence snippets. It should add:

- module responsibility summaries
- subsystem grouping
- likely data/control flow
- architectural risks
- "where to start" guidance for AI agents
- open questions and uncertain assumptions

LLM-generated nodes and edges must be marked `INFERRED` or `AMBIGUOUS`.

Every LLM summary should cite evidence node IDs or file paths. If it cannot cite
evidence, it should be omitted or marked `AMBIGUOUS`.

### 6. Report

Generate AI-readable outputs:

- `PROJECT_GRAPH.md`
- Obsidian `architecture/project-graph-*.md`
- Obsidian community and important-node pages
- graph stats in `.mindstrate/project-graph.json`
- optional machine-readable export for debugging

The report should answer:

- What is this project?
- What are the major subsystems?
- What files should an AI read first?
- What directories should not be edited?
- What are the most important entry points?
- What dependencies and configs shape runtime behavior?
- Which facts came from parser/config extraction?
- What is known from source versus inferred?
- What questions remain unresolved?

The report should also include:

- important nodes by centrality and dependency degree
- "god nodes" that many areas depend on
- blast radius for high-impact files or modules
- communities/subsystems inferred from graph structure
- suggested questions an AI agent can ask the graph
- surprising cross-subsystem connections

The report is an entry point, not a giant context blob. Agents should use it to
choose graph queries and source files, not paste the entire graph into a prompt.

## External Ideas To Adopt

From Graphify, adopt:

- pipeline structure: detect, extract, build graph, analyze, report
- deterministic parser facts first, LLM interpretation second
- provenance labels for extracted versus inferred relationships
- AI-readable graph report
- cache-based incremental refresh
- graph statistics and "important nodes" summaries
- query/path/explain style graph access for small subgraphs
- community/wiki-style pages for clustered subsystems
- privacy boundary between local parser facts and optional LLM enrichment

From GitNexus, adopt:

- CLI and MCP as the primary daily-use interface.
- `context`-style 360-degree symbol/file view.
- `impact` and blast-radius analysis before edits.
- workspace change detection over Git, Perforce, filesystem hashes, or manual
  file lists to explain what changed and what may break.
- multi-repository registry so one local/team server can serve many indexed
  repositories.
- generated repo-specific agent guidance and skills.
- web graph explorer backed by local or team graph data.
- tree-sitter parser adapters and query packs for broader language coverage.
- watch and hook based refresh workflows.

Do not adopt directly:

- separate external CLI output as the main source of truth
- graph-only artifacts disconnected from Mindstrate ECS
- mandatory LLM analysis before deterministic facts exist
- LLM-generated "facts" that could have been extracted by parser logic
- excessive command flags that expose internal analysis strategy to users

Mindstrate should implement this natively using its server APIs and context
graph.

## Rule System Role

Keep the rule system, but change its purpose.

The previous rule-generated snapshot approach is too shallow. Rule JSON should
not try to produce the final AI understanding through `overview`, `invariants`,
or generic directory descriptions. Those fields may remain as fallback hints,
but the project graph should be built from parsed source, manifests, config, and
docs.

Rules should provide:

- project type detection
- parser adapter selection
- tree-sitter query pack selection
- convention extractor selection
- source roots
- generated roots
- ignored directories
- important manifests
- risk hints for dangerous-to-edit areas
- framework-specific route/component conventions

Future rule shape should move toward:

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
    ]
  },
  "parserAdapters": [
    "unreal-manifest",
    "unreal-build",
    "unreal-config"
  ],
  "queryPacks": [
    "cpp-light",
    "csharp-build-light"
  ],
  "conventionExtractors": [
    "unreal-modules"
  ],
  "sourceRoots": [
    "Source",
    "Plugins"
  ],
  "generatedRoots": [
    "Binaries",
    "Intermediate",
    "Saved",
    "DerivedDataCache"
  ],
  "ignore": [
    "Binaries",
    "Intermediate",
    "Saved",
    "DerivedDataCache"
  ],
  "manifests": [
    "*.uproject",
    "Source/**/*.Build.cs",
    "Source/**/*.Target.cs"
  ],
  "riskHints": [
    "Do not edit generated Unreal output unless explicitly requested."
  ]
}
```

React/Vue/Next/Nuxt/Vite rules should similarly select tree-sitter query packs,
SFC parsers, route convention extractors, source roots, build outputs, route
conventions, and public asset directories.

This keeps custom team/project support without pretending declarative rules can
replace parser-based understanding.

## Graph Query Interface

Mindstrate should expose graph access through server APIs, CLI commands, and MCP
tools. The important behavior is returning small, relevant subgraphs rather than
dumping the whole graph.

Initial query operations:

- `query_project_graph(query, filters)`: semantic and structured graph search.
- `get_node(id)`: retrieve one node with facts, provenance, and evidence.
- `get_neighbors(id, depth, edgeTypes)`: expand a local neighborhood.
- `shortest_path(from, to)`: explain how two files/modules/concepts connect.
- `explain_node(id)`: summarize why a node matters, citing extracted evidence.
- `blast_radius(id)`: show likely affected nodes when this node changes.
- `context(id)`: return a 360-degree view of a symbol, file, module, route, or
  component.
- `detect_changes(source)`: analyze workspace changes and map them onto graph
  nodes, edges, affected communities, and likely risks.

CLI surface:

```bash
mindstrate graph report
mindstrate graph stats
mindstrate graph query "auth session flow"
mindstrate graph explain src/auth/session.ts
mindstrate graph path src/auth/session.ts src/db/client.ts
mindstrate graph context src/auth/session.ts
mindstrate graph impact src/auth/session.ts
mindstrate graph changes
mindstrate graph changes --source p4
mindstrate graph changes --source git --range HEAD~1..HEAD
mindstrate graph changes --files Source/Foo.cpp Scripts/foo.lua
```

MCP tools should mirror these operations so AI assistants can ask focused graph
questions before falling back to broad source scans.

The MCP server should prefer tool responses with bounded subgraphs, evidence
paths, and suggested next queries. It should not return the entire graph unless
the caller explicitly asks for a debug export.

## Report And Obsidian Shape

Local and Obsidian output should be structured for humans and agents:

```text
PROJECT_GRAPH.md
architecture/project-graph-<project>.md
architecture/communities/index.md
architecture/communities/<community-slug>.md
architecture/nodes/<important-node-slug>.md
```

`PROJECT_GRAPH.md` should include:

- project summary
- graph coverage stats
- first files to read
- entry points
- subsystem/community map
- god nodes
- high blast-radius files
- generated/do-not-edit areas
- extracted facts versus inferred conclusions
- suggested graph queries
- unresolved questions

Community pages should include:

- member files/modules/components
- incoming and outgoing dependencies
- likely responsibility
- high-risk edges
- evidence paths

Important node pages should include:

- why the node matters
- imports/exports/dependents
- nearest concepts or decisions
- blast radius
- evidence and provenance

## Always-On Agent Guidance

Setup should install guidance for supported AI tools so agents use Mindstrate
before broad source search for architecture questions.

Targets:

- `AGENTS.md`
- OpenCode configuration
- Cursor rules
- Claude Desktop/MCP setup notes
- Codex MCP setup notes

Guidance should be short and operational:

- For architecture, dependency, ownership, or "where should I edit" questions,
  query Mindstrate project graph first.
- Read `PROJECT_GRAPH.md` before scanning the repository.
- Use graph neighbors/path/blast-radius before editing high-impact files.
- Treat `EXTRACTED` as source facts and `INFERRED`/`AMBIGUOUS` as hypotheses.

Generated guidance may include repo-specific "skills" or context bundles for
major communities. These should be derived from the graph and should not
overwrite user-authored guidance.

## Incremental Watch And Hooks

`mindstrate init` is idempotent and incremental. Later phases can add automatic
refresh triggers:

- `mindstrate watch`
- git post-commit hook
- git post-checkout hook
- Perforce submit/sync workflow guidance
- optional pre-commit warning for stale graph data

Refresh rules:

- unchanged file hash: skip
- changed source file: rerun the parser adapter and query packs for that file
  and affected edges
- changed manifest/config: rerun relevant config extractor and graph merge
- changed docs: rerun markdown extractor and optional LLM semantic pass
- deleted file: remove or archive file-owned nodes and edges
- workspace change set: run change detection and report affected nodes,
  communities, layers, and risk hints

LLM should not rerun for every source edit. It should run when semantic evidence
changes enough to affect summaries, or when the user explicitly asks for a
report refresh and an LLM provider is configured.

Change detection should be available without watch mode. A developer or AI agent
should be able to ask "what do my current changes affect?" regardless of whether
the project uses Git, Perforce, mixed VCS, or no VCS.

## Workspace Change Detection

Mindstrate should not treat diff as a Git-only operation. Diff means "which
workspace changes map to which graph nodes and risks?"

Use a unified change set model:

```ts
type ChangeSource = "git" | "p4" | "filesystem" | "manual";

type ChangeSet = {
  source: ChangeSource;
  base?: string;
  head?: string;
  files: ChangedFile[];
};

type ChangedFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "moved";
  oldPath?: string;
  language?: string;
  layerId?: string;
};
```

Adapters:

- Git adapter:
  - uses `git status --porcelain` for current workspace changes
  - uses `git diff --name-status <range>` for explicit ranges
- Perforce adapter:
  - uses `p4 opened` for pending changelists
  - uses `p4 diff -se` / `p4 diff -sd` for changed or missing files
  - uses `p4 describe` for submitted or shelved changelists
- Filesystem adapter:
  - compares current file hashes against Mindstrate's cache
  - works for projects with no VCS or generated local changes
- Manual adapter:
  - accepts explicit file paths from a user or AI tool
  - useful for editor selections, failing test output, or external build logs

Multiple adapters may be active at once. This matters for mixed Git + Perforce
projects where engine/content assets are in P4 while scripts, tools, or
automation are in Git.

Change detection output should include:

- changed files grouped by source adapter
- affected graph nodes
- affected project layers
- affected communities/subsystems
- blast-radius estimate
- build/runtime/asset/config risk hints
- suggested follow-up graph queries

## Multi-Root And Layered Projects

Large game and enterprise projects often have multiple technical layers:

- compiled host language
- scripting language
- editor tooling
- assets/content
- configuration
- generated build output

Mindstrate should model these as project layers:

```ts
type ProjectLayer = {
  id: string;
  label: string;
  roots: string[];
  language?: string;
  parserAdapters: string[];
  queryPacks?: string[];
  conventionExtractors?: string[];
  changeAdapters?: ChangeSource[];
  generated?: boolean;
};
```

Examples:

- Unreal:
  - `gameplay-cpp`: `Source/`, `Plugins/`, C++ query packs and Unreal build
    parsers
  - `content-assets`: `Content/`, asset metadata/reference parsers
  - `config`: `Config/`, INI/config parsers
  - `scripts`: `Scripts/`, Lua/Python/TypeScript query packs if present
  - `generated`: `Binaries/`, `Intermediate/`, `Saved/`, ignored by default
- Unity:
  - `runtime-csharp`: `Assets/Scripts/`, C# query pack
  - `editor-csharp`: `Assets/Editor/`, C# editor tooling query pack
  - `assets`: `Assets/`, asset metadata/reference parser
  - `packages`: `Packages/`, manifest/config parser
  - `generated`: `Library/`, `Temp/`, `obj/`, ignored by default

Cross-layer impact is a first-class use case:

- C++ API changes may affect script bindings or Blueprint references.
- C# runtime changes may affect Unity scenes and prefabs.
- Config changes may affect packaged build behavior.
- Asset renames may affect code, scenes, prefabs, or data tables.

Rules should help define layers, source roots, generated roots, and preferred
change adapters. Parser adapters and query packs then build facts inside each
layer, and graph impact analysis connects changes across layers.

## Multi-Repository Registry

Mindstrate should support both single-project local usage and multi-repository
workspaces.

Local personal usage:

- `mindstrate init` registers the current repository in local Mindstrate state.
- MCP tools can infer the active repository from cwd when possible.
- Graph queries default to the active repository.

Team or power-user usage:

- a registry maps repository roots to graph metadata, project names, and graph
  storage IDs.
- one MCP server can serve multiple indexed repositories.
- graph query tools require or infer `repoId` when more than one repository is
  available.
- Team Server can store shared graph facts and reports for registered
  repositories.

Registry entries should include:

- `repoId`
- project name
- root path or remote URL
- last indexed commit
- last indexed time
- graph version
- available parser adapters and query packs
- LLM enrichment status

## Team Sharing

Teams should be able to share graph outputs without committing local cache or
private cost data.

Recommended files:

- Commit or publish `PROJECT_GRAPH.md` when the team wants a readable graph
  guide in the repository.
- Commit or publish selected Obsidian graph pages when the team uses an
  Obsidian vault as shared project memory.
- Store canonical graph facts in Team Server for shared deployments.
- Share registry metadata through Team Server for multi-repository deployments.

Do not commit by default:

- `.mindstrate/cache/`
- `.mindstrate/cost.json`
- machine-local provider config
- raw LLM prompt/response logs that may contain sensitive code

## Privacy Boundary

Default privacy posture:

- Parser facts are extracted locally.
- Full source files are not sent to LLM providers by default.
- LLM enrichment receives only selected evidence snippets and graph facts.
- If no LLM provider is configured, no LLM calls happen.
- All LLM-generated graph data is labeled `INFERRED` or `AMBIGUOUS`.
- Reports should show whether LLM enrichment was used.

The setup wizard should state this plainly before starting analysis.

## Evaluation Metrics

The project graph is valuable only if it improves agent behavior. Evaluation
should compare legacy metadata snapshots against graph init on open fixtures.

Metrics:

- task success rate
- number of files opened before first useful edit
- wrong-file edit rate
- generated-code rollback rate
- token usage
- time to answer architecture questions
- ability to identify risky/generated directories
- ability to cite evidence for a conclusion
- impact prediction quality for changed files
- workspace change explanation accuracy across Git, Perforce, filesystem, and
  manual file lists
- multi-repo query correctness when multiple repositories are registered
- cross-layer impact accuracy for host language, scripting, asset, and config
  changes

Evaluation tasks should include:

- "Where should I change auth/session behavior?"
- "Which files define the app route entry?"
- "What changes if this shared module changes?"
- "Which folders are generated or dangerous to edit?"
- "Explain the dependency path between two modules."
- "What do my current workspace changes affect?"
- "What does this P4 changelist affect?"
- "Which registered repository owns this file or concept?"
- "Will this host-language API change affect scripts or assets?"

Publish fixtures and expected graph assertions so claims are inspectable.

## Parser Strategy

Prefer well-supported parsers over ad hoc string matching. Source-code parsing
should be tree-sitter-first, not TypeScript-AST-first. Mindstrate should not
grow a separate hand-written AST walker for every language.

Initial implementation choices:

- Source code: tree-sitter runtime with a parser registry and query packs.
- TypeScript/JavaScript/TSX/JSX: tree-sitter grammars plus TypeScript, JSX,
  React, and framework-specific query packs.
- Vue SFC: `@vue/compiler-sfc` to split SFC structure, then tree-sitter for
  script blocks and a lightweight template-reference extractor where useful.
- Markdown: markdown parser such as `mdast`/`remark`.
- JSON: native JSON parser.
- TOML/INI/YAML: structured parsers where already available or lightweight
  parser modules where needed.
- Unreal build files: first parse known `*.Build.cs` and `*.Target.cs` patterns
  deterministically or with tree-sitter query packs when C# support is
  available.
- C++/C#/Python/Lua and other source languages: add tree-sitter grammars and
  query packs incrementally. Use clang or language servers later only when
  semantic type resolution is required.

The first version should avoid building custom parsers for entire languages and
should also avoid binding the core graph pipeline to one language-specific AST
API. String matching is acceptable only for small, stable config patterns such
as Unreal module dependencies in build files.

Add the parser adapter layer before language-specific extraction grows:

```ts
type ParserAdapter = {
  id: string;
  languages: string[];
  parse(input: ParserInput): Promise<ExtractionResult>;
};

type QueryPack = {
  id: string;
  language: string;
  captures: string[];
};
```

The graph pipeline consumes only the shared `ExtractionResult` model. Tree-sitter
query packs, Vue SFC parsing, Markdown parsing, and structured manifest parsers
all return that model. This lets Mindstrate absorb GitNexus-style broad language
coverage without tying the core graph pipeline to one parser library or one
language-specific AST API.

## CLI Changes

Command surface:

```bash
mindstrate init
mindstrate graph report
mindstrate graph stats
mindstrate graph query
mindstrate graph explain
mindstrate graph path
mindstrate graph context
mindstrate graph impact
mindstrate graph changes
```

`mindstrate init` performs initial analysis and incremental refresh. It should
choose the best available path automatically from project facts and LLM
configuration.

`mindstrate graph report` regenerates the readable report from existing graph
data.

`mindstrate graph stats` prints graph health and coverage metrics.

`mindstrate graph query`, `mindstrate graph explain`, and `mindstrate graph path`
return focused graph context for humans and MCP clients.

`mindstrate graph context` returns a 360-degree view around a file, symbol,
module, route, component, or concept.

`mindstrate graph impact` estimates blast radius for a node before editing.

`mindstrate graph changes` maps Git, Perforce, filesystem, or manual file
changes onto graph impact and risk.

`mindstrate setup` should call `mindstrate init` through the same analysis
engine and show progress.

## Implementation Phases

### Phase 0: Domain Model And Storage

Deliver:

- graph node and edge DTOs for project graph extraction
- provenance model: `EXTRACTED`, `INFERRED`, `AMBIGUOUS`
- evidence references: file path, line span when available, extractor id
- stable node ID scheme
- graph merge/upsert behavior for incremental refresh
- cache metadata schema
- repository registry schema
- workspace change adapter interface
- project layer model

Validation:

- repeated extraction creates stable node IDs
- deleted files archive or remove file-owned graph facts
- provenance and evidence survive graph writes
- registry can store and retrieve multiple repositories without cross-project
  graph contamination
- change sets from Git, Perforce, filesystem cache, and manual paths normalize
  into the same model

### Phase 1: Parser Adapter And Tree-Sitter Extractors

Deliver:

- scanner with ignore support
- cache by file hash
- graph extraction result model
- parser adapter interface
- tree-sitter runtime spike for Windows and CI compatibility
- tree-sitter parser registry
- query pack loading and execution
- TypeScript/JavaScript/TSX/JSX query packs
- React component and hook query captures
- Next route and entry convention extractor
- Vue SFC structure parser that delegates script blocks to source query packs
- package manifest extractor
- Markdown heading/decision extractor
- Unreal manifest/module extractor
- ECS graph write path
- progress events from scanner, parser adapters, and convention extractors

Validation:

- React/Vue/Next/Vite fixture projects produce useful nodes and edges.
- tree-sitter query packs find imports, exports, components, functions, and
  routes without using an LLM.
- Unreal fixture project identifies modules and generated directories.
- Running `init` again after changing one file only reprocesses changed files.

### Phase 2: Report, Stats, And Query Surface

Deliver:

- `PROJECT_GRAPH.md` report
- Obsidian architecture graph page
- community pages
- important-node pages
- `mindstrate graph report`
- `mindstrate graph stats`
- `mindstrate graph query`
- `mindstrate graph explain`
- `mindstrate graph path`
- MCP tools for query, node, neighbors, path, explain, blast radius
- graph context, impact, and changes commands/tools
- workspace change adapter integration for graph changes

Validation:

- generated report contains first-read files, subsystems, entry points,
  provenance counts, god nodes, blast-radius notes, and suggested questions.
- query APIs return bounded subgraphs rather than full graph dumps.
- MCP tools can answer "where should I edit?" using graph context.
- impact and changes outputs cite affected nodes, project layers, and evidence.

### Phase 3: Setup Wizard And Progress

Deliver:

- setup confirmation for estimated scan scope and optional LLM usage
- progress bar in setup/init
- cancellation-safe writes
- clear copy about deterministic extraction and optional LLM enrichment
- final summary with node/edge/file counts

Validation:

- setup remains usable on small projects.
- large project progress updates at least every few seconds.
- failures show which phase failed and keep partial graph data consistent.

### Phase 4: LLM Summaries And Inference

Deliver:

- provider-aware LLM analysis step
- bounded file/context selection
- subsystem summaries
- inferred relationships
- open questions section
- cost/time estimates

Validation:

- no LLM calls when no provider is configured.
- LLM output is marked `INFERRED` or `AMBIGUOUS`.
- deterministic facts remain unchanged if LLM output changes.
- LLM summaries cite extracted evidence nodes or file paths.

### Phase 5: External Change Integration And Team Sharing

Deliver:

- server `memory.context.ingestProjectGraphChangeSet(project, changeSet)` API
- CLI `mindstrate graph ingest --changes <file|->` for external collectors
- repo-scanner source adapter contract for custom data collectors
- standard external input shapes: event, project graph `ChangeSet`, portable bundle
- repo-scanner ownership of Git / Perforce / hook / daemon / cursor / retry logic
- Team Server graph publish/sync path remains the shared team output
- repository guidance for what to commit versus ignore
- AI tool guidance installation
- generated repo-specific context bundles/skills

Validation:

- external collectors can submit changed files without the server reading Git,
  Perforce, hooks, or filesystem watcher state directly.
- source-only edits map to affected parser facts without rerunning full project.
- docs edits can submit semantic refresh inputs when an LLM provider exists.
- agent guidance is installed without overwriting user-authored instructions.
- one MCP server can query multiple registered repositories safely through
  explicit project-scoped inputs.
- change impact analysis identifies affected nodes, communities, layers, and
  risk hints across standardized Git, Perforce, filesystem, custom collector,
  or manual `ChangeSet` inputs.

### Phase 6: Evaluation Dataset

Deliver:

- built-in fixture definitions for React, Vue, Next, Node service, and
  Unreal-style projects
- fixture materialization API for reproducible local evaluation projects
- expected graph shape assertions for files, nodes, edges, and required graph
  node titles
- before/after AI task prompts comparing legacy snapshot-only guidance with
  project graph guided work
- metrics: task success, files opened, wrong files opened, time-to-answer
- Markdown dataset report renderer
- `mindstrate graph eval-dataset --out <dir>` to export the report and fixture
  projects

Validation:

- compare legacy metadata snapshot versus graph init.
- publish dataset and reports so users can inspect claims.
- fixture graph shape tests run deterministically without LLM calls.

## Success Criteria

The generated project graph is useful only if it helps an AI agent work better.

Minimum bar:

- It identifies more than metadata: modules, entry flows, dependencies, and
  constraints.
- It extracts code facts through tree-sitter query packs and parsers instead of
  LLM guessing.
- It distinguishes facts from inferences.
- It points AI to the right files for common tasks.
- It warns about generated or dangerous-to-edit areas.
- It can be refreshed incrementally.
- It exports readable artifacts for humans and agents.

If a new user opens the Obsidian export and still only sees a generic project
summary, this plan has failed.
