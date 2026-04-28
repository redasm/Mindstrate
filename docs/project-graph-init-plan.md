# Project Graph Init Plan

## Goal

`mindstrate init` should produce useful project understanding by default. A
basic metadata snapshot is not enough for either humans or AI agents: knowing
that a project is "React" or "Unreal" does not explain the important modules,
ownership boundaries, entry flows, dependencies, or change risks.

The new default should be an AST-first project graph analysis pipeline inspired
by Graphify v5:

- Use AST and parser-based extraction for source facts.
- Use rule packs to choose project-specific extraction strategy.
- Use optional LLM analysis for summaries and inferred relationships.
- Store facts and inferences in Mindstrate's context graph.
- Export AI-readable reports to Obsidian and local files.

Rules identify project shape and select extraction strategy. AST and parsers
discover facts. LLMs explain and connect those facts. The system should not ask
an LLM to guess what a parser can prove.

## Product Positioning

`mindstrate init` becomes "build the first useful project knowledge graph".

There should not be a low-quality quick mode. If the graph is too shallow to
help an AI agent understand the project, it should not be the default or an
advertised path.

LLM usage should be automatic:

- If an LLM provider is configured, `init` uses it after AST/parser extraction.
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
- project-specific extractor hints

Rules remain declarative JSON. They select strategies; they do not execute code.
For example, a React rule can select the TypeScript/JSX extractor, while an
Unreal rule can select `.uproject`, `*.Build.cs`, and config extractors.

Rules are a routing and boundary layer, not the knowledge layer. They should not
be treated as the main source of project understanding. Their job is to tell the
scanner what kind of project this is, which extractors to run, where source code
lives, and which generated or dangerous directories to avoid.

### 2. Scan

Build a project file inventory:

- Respect `.gitignore`, `.mindstrateignore`, and rule-provided ignore dirs.
- Ignore generated and dependency directories by default.
- Record path, size, extension, hash, modified time, and language.
- Cache file hashes for incremental refresh.

### 3. Extract Facts With AST And Parsers

Run deterministic extractors before any LLM step. Facts extracted from ASTs,
structured manifests, config files, and documentation parsers should be marked
as `EXTRACTED`.

LLMs must not create source facts such as imports, exports, functions, routes,
or package dependencies. They may only summarize or infer relationships from
already extracted evidence.

Initial extractors:

- TypeScript/JavaScript AST:
  - package dependencies
  - scripts
  - static imports and exports
  - dynamic imports when statically resolvable
  - top-level functions, classes, interfaces, types, and enums
  - React component declarations
  - React hooks usage
  - route handler exports when detectable
  - Next/Nuxt route files
  - Vite config and bootstrap entry points
- Vue SFC parser:
  - `<script>` and `<script setup>` imports
  - props and emits
  - component name
  - template component references when cheap to extract
- Unreal/C++:
  - `.uproject`
  - `*.Build.cs`
  - `*.Target.cs`
  - Unreal modules and dependencies from build files
  - config files
  - generated directories to avoid
- Markdown/docs:
  - markdown AST headings
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
- Which facts came from AST/config parsing?
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

## Graphify-Inspired Ideas To Adopt

Adopt:

- pipeline structure: detect, extract, build graph, analyze, report
- AST/parser facts first, LLM interpretation second
- provenance labels for extracted versus inferred relationships
- AI-readable graph report
- cache-based incremental refresh
- graph statistics and "important nodes" summaries
- query/path/explain style graph access for small subgraphs
- community/wiki-style pages for clustered subsystems
- always-on guidance that tells coding agents to query the graph before
  broad source search
- watch and hook based refresh workflows
- privacy boundary between local AST facts and optional LLM enrichment

Do not adopt directly:

- separate external CLI output as the main source of truth
- graph-only artifacts disconnected from Mindstrate ECS
- mandatory LLM analysis before deterministic facts exist
- LLM-generated "facts" that could have been extracted by AST or parser logic

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
- extractor selection
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
  "extractors": [
    "unreal-manifest",
    "unreal-build",
    "unreal-config",
    "cpp-light"
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

React/Vue/Next/Nuxt/Vite rules should similarly select AST/SFC/route extractors
and define source roots, build outputs, route conventions, and public asset
directories.

This keeps custom team/project support without pretending declarative rules can
replace AST-based understanding.

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

CLI surface:

```bash
mindstrate graph report
mindstrate graph stats
mindstrate graph query "auth session flow"
mindstrate graph explain src/auth/session.ts
mindstrate graph path src/auth/session.ts src/db/client.ts
```

MCP tools should mirror these operations so AI assistants can ask focused graph
questions before falling back to broad source scans.

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

## Incremental Watch And Hooks

`mindstrate init` is idempotent and incremental. Later phases can add automatic
refresh triggers:

- `mindstrate watch`
- git post-commit hook
- git post-checkout hook
- optional pre-commit warning for stale graph data

Refresh rules:

- unchanged file hash: skip
- changed source file: rerun AST extractor for that file and affected edges
- changed manifest/config: rerun relevant config extractor and graph merge
- changed docs: rerun markdown extractor and optional LLM semantic pass
- deleted file: remove or archive file-owned nodes and edges

LLM should not rerun for every source edit. It should run when semantic evidence
changes enough to affect summaries, or when the user explicitly asks for a
report refresh and an LLM provider is configured.

## Team Sharing

Teams should be able to share graph outputs without committing local cache or
private cost data.

Recommended files:

- Commit or publish `PROJECT_GRAPH.md` when the team wants a readable graph
  guide in the repository.
- Commit or publish selected Obsidian graph pages when the team uses an
  Obsidian vault as shared project memory.
- Store canonical graph facts in Team Server for shared deployments.

Do not commit by default:

- `.mindstrate/cache/`
- `.mindstrate/cost.json`
- machine-local provider config
- raw LLM prompt/response logs that may contain sensitive code

## Privacy Boundary

Default privacy posture:

- AST and parser facts are extracted locally.
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

Evaluation tasks should include:

- "Where should I change auth/session behavior?"
- "Which files define the app route entry?"
- "What changes if this shared module changes?"
- "Which folders are generated or dangerous to edit?"
- "Explain the dependency path between two modules."

Publish fixtures and expected graph assertions so claims are inspectable.

## Parser Strategy

Prefer well-supported parsers over ad hoc string matching.

Initial implementation choices:

- TypeScript/JavaScript: TypeScript Compiler API.
- TSX/JSX: TypeScript Compiler API with JSX support.
- Vue SFC: `@vue/compiler-sfc`.
- Markdown: markdown AST parser such as `mdast`/`remark`.
- JSON: native JSON parser.
- TOML/INI/YAML: structured parsers where already available or lightweight
  parser modules where needed.
- Unreal build files: first parse known `*.Build.cs` and `*.Target.cs` patterns
  deterministically; full C++ AST can come later.
- C++: defer full AST until tree-sitter or clang integration is chosen.

The first version should avoid building custom parsers for entire languages.
String matching is acceptable only for small, stable config patterns such as
Unreal module dependencies in build files.

## CLI Changes

Command surface:

```bash
mindstrate init
mindstrate graph report
mindstrate graph stats
mindstrate graph query
mindstrate graph explain
mindstrate graph path
```

`mindstrate init` performs initial analysis and incremental refresh. It should
choose the best available path automatically from project facts and LLM
configuration.

`mindstrate graph report` regenerates the readable report from existing graph
data.

`mindstrate graph stats` prints graph health and coverage metrics.

`mindstrate graph query`, `mindstrate graph explain`, and `mindstrate graph path`
return focused graph context for humans and MCP clients.

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

Validation:

- repeated extraction creates stable node IDs
- deleted files archive or remove file-owned graph facts
- provenance and evidence survive graph writes

### Phase 1: AST Scanner And Deterministic Extractors

Deliver:

- scanner with ignore support
- cache by file hash
- graph extraction result model
- TypeScript/JavaScript AST extractor
- React component and hook extractor
- Next route and entry extractor
- Vue SFC extractor
- package manifest extractor
- Markdown AST heading/decision extractor
- Unreal manifest/module extractor
- ECS graph write path
- progress events from scanner/extractors

Validation:

- React/Vue/Next/Vite fixture projects produce useful nodes and edges.
- AST extraction finds imports, exports, components, functions, and routes
  without using an LLM.
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

Validation:

- generated report contains first-read files, subsystems, entry points,
  provenance counts, god nodes, blast-radius notes, and suggested questions.
- query APIs return bounded subgraphs rather than full graph dumps.
- MCP tools can answer "where should I edit?" using graph context.

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

### Phase 5: Watch, Hooks, And Team Sharing

Deliver:

- `mindstrate watch`
- optional git hook installation through setup
- stale graph warning
- Team Server graph publish/sync path
- repository guidance for what to commit versus ignore
- AI tool guidance installation

Validation:

- source-only edits refresh affected AST facts without rerunning full project.
- docs edits can trigger semantic report refresh when an LLM provider exists.
- agent guidance is installed without overwriting user-authored instructions.

### Phase 6: Evaluation Dataset

Deliver:

- open test projects for React, Vue, Next, Node service, Unreal-style fixture
- expected graph shape assertions
- before/after AI task evaluation prompts
- metrics: task success, files opened, wrong edits avoided, time-to-answer

Validation:

- compare legacy metadata snapshot versus graph init.
- publish dataset and reports so users can inspect claims.

## Success Criteria

The generated project graph is useful only if it helps an AI agent work better.

Minimum bar:

- It identifies more than metadata: modules, entry flows, dependencies, and
  constraints.
- It extracts code facts through AST/parsers instead of LLM guessing.
- It distinguishes facts from inferences.
- It points AI to the right files for common tasks.
- It warns about generated or dangerous-to-edit areas.
- It can be refreshed incrementally.
- It exports readable artifacts for humans and agents.

If a new user opens the Obsidian export and still only sees a generic project
summary, this plan has failed.
