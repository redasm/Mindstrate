/**
 * Project graph indexing orchestrator.
 *
 * Drives the full extraction flow:
 *   1. Plan + scan the project (delegates to `scanner.ts`).
 *   2. For each scanned file, run the right extractors (generic source via
 *      tree-sitter, Unreal-specific via `unreal-fact-builder`, dependency
 *      manifests via `addPackageFacts`).
 *   3. Persist extracted nodes/edges through `graph-writer`.
 *   4. Run second-pass binding inference in SQL (`project-graph-binding`).
 *
 * Per-engine and per-language fact recipes live in their own modules so this
 * file can stay focused on flow rather than recipes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { noopLogger, type Logger } from '../runtime/logger.js';
import { safeJson } from '../project/detection-support.js';
import { createProjectGraphNodeId } from './node-id.js';
import type { ParserAdapter, ParserCapture } from './parser-adapter.js';
import {
  buildProjectGraphScanPlan,
  scanProjectFiles,
  type ProjectFileInventoryEntry,
  type ProjectGraphScanPlan,
  type ProjectGraphScanProgress,
} from './scanner.js';
import { createTreeSitterSourceParser } from './tree-sitter-source-parser.js';
import { createUnrealCppParserAdapter } from './unreal-cpp-parser-adapter.js';
import { createScriptRegexParserAdapter } from './script-parser-adapter.js';
import {
  applyEdgeWrites,
  applyStreamedNodeWrites,
  emptyWriteResult,
  type ProjectGraphExtractionResult,
  type ProjectGraphWriteResult,
} from './graph-writer.js';
import {
  readProjectGraphExtractionCache,
  openProjectGraphExtractionCacheWriter,
  type ProjectGraphFileExtractionCache,
} from './extraction-cache.js';
import {
  addEdge,
  addNode,
  dependencyScopeFromCapture,
  evidence,
  fileNodeId,
  isUnrealBuildFile,
  isUnrealConfigFile,
  isUnrealManifestFile,
  longestMatchingRoot,
  makeEdge,
  makeFileNode,
  makeNode,
  stripQuotes,
  uniqueStrings,
} from './project-graph-fact-builder.js';
import {
  addUnrealAssetRegistryFacts,
  addUnrealBuildFacts,
  addUnrealConfigFacts,
  addUnrealManifestFacts,
} from './unreal-fact-builder.js';
import { bindProjectGraph } from './project-graph-binding.js';

export interface ProjectGraphIndexResult extends ProjectGraphWriteResult {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
  skippedFiles: number;
}

export interface ProjectGraphIndexOptions {
  onScanProgress?: (event: ProjectGraphScanProgress) => void;
  onIndexProgress?: (event: ProjectGraphIndexProgress) => void;
  /** Diagnostics sink for skipped/failed files. Defaults to {@link noopLogger}. */
  logger?: Logger;
}

export interface ProjectGraphIndexProgress {
  phase: 'extracting' | 'binding' | 'cache' | 'writing';
  filesProcessed: number;
  filesTotal: number;
  nodes: number;
  edges: number;
  path?: string;
  generatedFiles: number;
  metadataOnlyRoots: number;
  skippedFiles: number;
}

export const indexProjectGraph = (
  store: ContextGraphStore,
  project: DetectedProject,
  options: ProjectGraphIndexOptions = {},
): ProjectGraphIndexResult => {
  const stats = streamProjectGraphIntoStore(store, project, options);
  options.onIndexProgress?.({
    phase: 'writing',
    filesProcessed: stats.filesScanned,
    filesTotal: stats.filesScanned,
    nodes: stats.nodeCount,
    edges: stats.edgeCount,
    generatedFiles: stats.generatedFiles,
    metadataOnlyRoots: stats.metadataOnlyRoots,
    skippedFiles: stats.skippedFiles,
  });

  // Binding inference runs as SQL over the persisted graph (see
  // `project-graph-binding.ts`) rather than over in-memory node maps, so it
  // doesn't add the whole graph back onto the heap.
  options.onIndexProgress?.({
    phase: 'binding',
    filesProcessed: stats.filesScanned,
    filesTotal: stats.filesScanned,
    nodes: stats.nodeCount,
    edges: stats.edgeCount,
    generatedFiles: stats.generatedFiles,
    metadataOnlyRoots: stats.metadataOnlyRoots,
    skippedFiles: stats.skippedFiles,
  });
  const bindingResult = bindProjectGraph(store, project.name);
  const bindingEdges = bindingResult.edgesCreated + bindingResult.edgesUpdated + bindingResult.edgesSkipped;

  return {
    nodesCreated: stats.writeResult.nodesCreated,
    nodesUpdated: stats.writeResult.nodesUpdated,
    edgesCreated: stats.writeResult.edgesCreated + bindingResult.edgesCreated,
    edgesUpdated: stats.writeResult.edgesUpdated + bindingResult.edgesUpdated,
    edgesSkipped: stats.writeResult.edgesSkipped + bindingResult.edgesSkipped,
    filesScanned: stats.filesScanned,
    nodesExtracted: stats.nodeCount,
    edgesExtracted: stats.edgeCount + bindingEdges,
    skippedFiles: stats.skippedFiles,
  };
};

interface ProjectGraphStreamStats {
  filesScanned: number;
  generatedFiles: number;
  metadataOnlyRoots: number;
  skippedFiles: number;
  nodeCount: number;
  edgeCount: number;
  writeResult: ProjectGraphWriteResult;
}

interface ProjectGraphFileExtractionOutcome extends ProjectGraphExtractionResult {
  skipped: boolean;
}

/**
 * Files per write transaction. Each batch commits once, so the lock window on
 * the graph DB stays short (progress logging runs on a different connection and
 * must not be starved) while still amortizing fsyncs over many files instead of
 * paying one per row.
 */
const STREAM_FLUSH_FILES = 1000;

/**
 * Extract the project graph and stream it straight into the store.
 *
 * Memory: the graph is never assembled in a single resident map. Each file's
 * facts are stationed in a small batch buffer and committed every
 * {@link STREAM_FLUSH_FILES} files; cross-file/cross-run deduplication is by id
 * (a `Set` of ids already written this run, plus the store's upsert for rows
 * left by a previous run). The only heap that scales with repo size is the two
 * id `Set`s — strings, not full node/edge DTOs — so peak no longer tracks total
 * graph size. Binding inference runs afterwards in SQL (see `indexProjectGraph`).
 *
 * Trade-off vs. the old in-memory merge: a node id seen in several files keeps
 * the first file's evidence rather than the union of every file's. That union
 * mainly bloated hot DEPENDENCY nodes (one evidence entry per importing file);
 * per-file usage is still recoverable from the incoming edges, written in full.
 */
const streamProjectGraphIntoStore = (
  store: ContextGraphStore,
  project: DetectedProject,
  options: ProjectGraphIndexOptions,
): ProjectGraphStreamStats => {
  let skippedFiles = 0;
  const scanOptions = {
    sourceRoots: projectGraphDeepRoots(project),
    ignore: project.graphHints?.ignore,
    generatedRoots: project.graphHints?.generatedRoots,
    metadataOnlyRoots: project.graphHints?.layers
      ?.filter((layer) => layer.parserAdapters.includes('unreal-asset-metadata'))
      .flatMap((layer) => layer.roots),
    manifests: project.graphHints?.manifests,
    onProgress: (event: ProjectGraphScanProgress) => {
      skippedFiles = event.skippedFiles;
      options.onScanProgress?.(event);
    },
  };
  const scanPlan = buildProjectGraphScanPlan(project.root, scanOptions);
  const files = scanProjectFiles(project.root, scanOptions);
  const generatedFiles = files.filter((file) => file.generated).length;
  const metadataOnlyRoots = scanOptions.metadataOnlyRoots?.length ?? 0;
  const parserAdapters = [
    createUnrealCppParserAdapter(),
    createScriptRegexParserAdapter(),
    createTreeSitterSourceParser(),
  ];
  const previousCache = readProjectGraphExtractionCache(project.root);
  const cacheWriter = openProjectGraphExtractionCacheWriter(project.root);

  const writeResult = emptyWriteResult();
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  let batchNodes = new Map<string, ProjectGraphNodeDto>();
  let batchEdges = new Map<string, ProjectGraphEdgeDto>();

  // Buffer a file's facts, merging within the batch exactly as the old resident
  // map did (`addNode` unions, `addEdge` is last-wins). Cross-batch merging is
  // handled at commit by `applyStreamedNodeWrites` against the persisted row.
  const stage = (
    nodes: Map<string, ProjectGraphNodeDto>,
    edges: Map<string, ProjectGraphEdgeDto>,
  ): void => {
    for (const node of nodes.values()) addNode(batchNodes, node);
    for (const edge of edges.values()) addEdge(batchEdges, edge);
  };

  const commitBatch = (): void => {
    if (batchNodes.size === 0 && batchEdges.size === 0) return;
    const nodes = batchNodes;
    const edges = batchEdges;
    batchNodes = new Map();
    batchEdges = new Map();
    store.transaction(() => {
      applyStreamedNodeWrites(store, Array.from(nodes.values()), seenNodes, writeResult);
      for (const id of edges.keys()) seenEdges.add(id);
      applyEdgeWrites(store, Array.from(edges.values()), writeResult);
    });
  };

  try {
    const planNodes = new Map<string, ProjectGraphNodeDto>();
    const planEdges = new Map<string, ProjectGraphEdgeDto>();
    addScanPlanFacts(project, scanPlan, planNodes, planEdges);
    stage(planNodes, planEdges);

    files.forEach((file, index) => {
      const fileNodes = new Map<string, ProjectGraphNodeDto>();
      const fileEdges = new Map<string, ProjectGraphEdgeDto>();
      addNode(fileNodes, makeFileNode(project, file.path, scanPlan));
      addFileContainmentFact(project, file.path, scanPlan, fileNodes, fileEdges);
      const fileExtraction = extractFileFacts(project, file, parserAdapters, previousCache, options.logger ?? noopLogger);
      if (fileExtraction.skipped) skippedFiles += 1;
      if (!fileExtraction.skipped) {
        cacheWriter.write({
          path: file.path,
          hash: file.hash,
          nodes: fileExtraction.nodes,
          edges: fileExtraction.edges,
        });
      }
      for (const node of fileExtraction.nodes) addNode(fileNodes, node);
      for (const edge of fileExtraction.edges) addEdge(fileEdges, edge);
      stage(fileNodes, fileEdges);
      if ((index + 1) % STREAM_FLUSH_FILES === 0) commitBatch();
      options.onIndexProgress?.({
        phase: 'extracting',
        filesProcessed: index + 1,
        filesTotal: files.length,
        nodes: seenNodes.size,
        edges: seenEdges.size,
        generatedFiles,
        metadataOnlyRoots,
        skippedFiles,
        path: file.path,
      });
    });

    const assetNodes = new Map<string, ProjectGraphNodeDto>();
    const assetEdges = new Map<string, ProjectGraphEdgeDto>();
    addUnrealAssetRegistryFacts(project, assetNodes, assetEdges);
    stage(assetNodes, assetEdges);
    commitBatch();

    options.onIndexProgress?.({
      phase: 'cache',
      filesProcessed: files.length,
      filesTotal: files.length,
      nodes: seenNodes.size,
      edges: seenEdges.size,
      generatedFiles,
      metadataOnlyRoots,
      skippedFiles,
    });
  } finally {
    cacheWriter.close();
  }

  return {
    filesScanned: files.length,
    generatedFiles,
    metadataOnlyRoots,
    skippedFiles,
    nodeCount: seenNodes.size,
    edgeCount: seenEdges.size,
    writeResult,
  };
};

const extractFileFacts = (
  project: DetectedProject,
  file: ProjectFileInventoryEntry,
  parserAdapters: ParserAdapter[],
  previousCache: ProjectGraphFileExtractionCache,
  logger: Logger,
): ProjectGraphFileExtractionOutcome => {
  const cached = previousCache.files[file.path];
  if (cached?.hash === file.hash) {
    return { project: project.name, nodes: cached.nodes, edges: cached.edges, skipped: false };
  }

  const nodes = new Map<string, ProjectGraphNodeDto>();
  const edges = new Map<string, ProjectGraphEdgeDto>();
  let skipped = false;
  if (file.generated) {
    return { project: project.name, nodes: [], edges: [], skipped };
  }

  // Read the file at most once: the Unreal manifest/build/config recipes and the
  // source parsers all want the same bytes, and re-reading the same path 2–4×
  // turned large scans into an I/O-bound crawl.
  let contentLoaded = false;
  let contentValue: string | null = null;
  const content = (): string | null => {
    if (!contentLoaded) {
      contentValue = readSourceFile(file.absolutePath);
      contentLoaded = true;
    }
    return contentValue;
  };

  if (file.path === 'package.json') {
    addPackageFacts(project, file.path, nodes, edges);
  }
  if (isUnrealManifestFile(file.path)) {
    const c = content();
    if (c !== null) addUnrealManifestFacts(project, file.path, c, nodes, edges);
  }
  if (isUnrealBuildFile(file.path)) {
    const c = content();
    if (c !== null) addUnrealBuildFacts(project, file.path, c, nodes, edges, dependencyScopeFromCapture);
  }
  if (isUnrealConfigFile(file.path)) {
    const c = content();
    if (c !== null) addUnrealConfigFacts(project, file.path, c, nodes, edges);
  }
  const matchingParsers = file.language
    ? parserAdapters.filter((parser) => parser.languages.includes(file.language as never))
    : [];
  if (matchingParsers.length > 0) {
    const c = content();
    for (const parser of matchingParsers) {
      if (c === null) continue;
      const parsed = parseFileFacts(parser, file, c, logger);
      if (!parsed) {
        skipped = true;
        continue;
      }
      addSourceFacts(project, file.path, parsed.captures, nodes, edges);
    }
  }
  return { project: project.name, nodes: Array.from(nodes.values()), edges: Array.from(edges.values()), skipped };
};

const parseFileFacts = (
  parser: ParserAdapter,
  file: ProjectFileInventoryEntry,
  content: string,
  logger: Logger,
) => {
  try {
    return parser.parse({
      path: file.path,
      language: file.language ?? '',
      content,
    });
  } catch (error) {
    // Don't abort the scan, but surface *why* a file was skipped: a thrown
    // parse is a tree-sitter/adapter failure, distinct from an unsupported
    // language (which never reaches here). Silent `return null` made these
    // indistinguishable and undebuggable.
    logger.warn('[project-graph] parser failed; file skipped', {
      path: file.path,
      language: file.language ?? '',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const projectGraphDeepRoots = (project: DetectedProject): string[] | undefined => {
  const roots = [
    ...(project.graphHints?.sourceRoots ?? []),
    ...(project.graphHints?.layers ?? [])
      .filter((layer) => !layer.generated && !layer.parserAdapters.includes('unreal-asset-metadata'))
      .flatMap((layer) => layer.roots),
  ];
  return roots.length > 0 ? uniqueStrings(roots) : undefined;
};

// ============================================================
// Scan-plan / containment facts
// ============================================================

const addScanPlanFacts = (
  project: DetectedProject,
  scanPlan: ProjectGraphScanPlan,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const projectNode = makeNode(project, ProjectGraphNodeKind.PROJECT, project.name, project.name, evidence(project.manifestPath ?? '.'), {
    scanMode: 'project',
  });
  addNode(nodes, projectNode);
  for (const root of scanPlan.deepRoots) addDirectoryFact(project, root, 'deep', projectNode.id, nodes, edges);
  for (const root of scanPlan.metadataOnlyRoots) addDirectoryFact(project, root, 'metadata-only', projectNode.id, nodes, edges);
  for (const root of scanPlan.generatedRoots) addDirectoryFact(project, root, 'generated', projectNode.id, nodes, edges);
  for (const manifest of scanPlan.manifestFiles) {
    const manifestNode = makeFileNode(project, manifest, scanPlan);
    addNode(nodes, manifestNode);
    addEdge(edges, makeEdge(projectNode.id, manifestNode.id, ProjectGraphEdgeKind.CONTAINS, evidence(manifest)));
  }
};

const addDirectoryFact = (
  project: DetectedProject,
  root: string,
  scanMode: 'deep' | 'metadata-only' | 'generated',
  parentId: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const node = makeNode(project, ProjectGraphNodeKind.DIRECTORY, root, root, evidence(root), { scanMode });
  addNode(nodes, node);
  addEdge(edges, makeEdge(parentId, node.id, ProjectGraphEdgeKind.CONTAINS, evidence(root)));
};

const addFileContainmentFact = (
  project: DetectedProject,
  filePath: string,
  scanPlan: ProjectGraphScanPlan,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const parentRoot = longestMatchingRoot(filePath, scanPlan.deepRoots);
  const parentId = parentRoot
    ? createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.DIRECTORY, key: parentRoot })
    : createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.PROJECT, key: project.name });
  addEdge(edges, makeEdge(parentId, fileNodeId(project, filePath), ProjectGraphEdgeKind.CONTAINS, evidence(filePath)));
};

// ============================================================
// Generic source / package extraction
// ============================================================

const readSourceFile = (absolutePath: string): string | null => {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch {
    return null;
  }
};

const addPackageFacts = (
  project: DetectedProject,
  filePath: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const packageJson = safeJson(path.join(project.root, filePath));
  if (!packageJson || typeof packageJson !== 'object') return;

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = (packageJson as Record<string, unknown>)[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps)) {
      addDependencyFact(project, filePath, name, nodes, edges, ProjectGraphEdgeKind.DEPENDS_ON);
    }
  }
};

const addSourceFacts = (
  project: DetectedProject,
  filePath: string,
  captures: ParserCapture[],
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  for (const capture of captures) {
    SOURCE_FACT_HANDLERS[capture.name]?.(project, filePath, capture, nodes, edges);
  }
};

type SourceFactHandler = (
  project: DetectedProject,
  filePath: string,
  capture: ParserCapture,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
) => void;

const dependencyHandler = (kind: ProjectGraphEdgeKind, options: { stripQuotes?: boolean } = {}): SourceFactHandler =>
  (project, filePath, capture, nodes, edges) => {
    const text = options.stripQuotes ? stripQuotes(capture.text) : capture.text;
    addDependencyFact(project, filePath, text, nodes, edges, kind, capture);
  };

const symbolHandler = (kind: ProjectGraphNodeKind): SourceFactHandler =>
  (project, filePath, capture, nodes, edges) => {
    addSymbolFact(project, filePath, capture.text, kind, nodes, edges, capture);
  };

/**
 * Capture-name -> handler dispatch for `addSourceFacts`.
 *
 * New parser adapters (`tree-sitter-source-parser`,
 * `unreal-cpp-parser-adapter`, `script-parser-adapter`, ...) plug new
 * captures in by adding an entry here. Captures the table does not name
 * are silently ignored, matching the previous if/else fallthrough.
 */
const SOURCE_FACT_HANDLERS: Record<string, SourceFactHandler> = {
  'import.source':   dependencyHandler(ProjectGraphEdgeKind.IMPORTS, { stripQuotes: true }),
  'export.source':   dependencyHandler(ProjectGraphEdgeKind.EXPORTS, { stripQuotes: true }),
  'function.name':   symbolHandler(ProjectGraphNodeKind.FUNCTION),
  'class.name':      symbolHandler(ProjectGraphNodeKind.CLASS),
  'call.function':   dependencyHandler(ProjectGraphEdgeKind.CALLS),
  'react.component': symbolHandler(ProjectGraphNodeKind.COMPONENT),
  'react.hook':      dependencyHandler(ProjectGraphEdgeKind.USES_HOOK),
  'unreal.class':    symbolHandler(ProjectGraphNodeKind.CLASS),
  'unreal.struct':   symbolHandler(ProjectGraphNodeKind.TYPE),
  'unreal.enum':     symbolHandler(ProjectGraphNodeKind.TYPE),
  'unreal.function': symbolHandler(ProjectGraphNodeKind.FUNCTION),
  'unreal.property': symbolHandler(ProjectGraphNodeKind.CONFIG),
  'script.import':   dependencyHandler(ProjectGraphEdgeKind.IMPORTS),
  'script.class':    symbolHandler(ProjectGraphNodeKind.CLASS),
  'script.function': symbolHandler(ProjectGraphNodeKind.FUNCTION),
  'script.ue-call':  dependencyHandler(ProjectGraphEdgeKind.CALLS),
  // Member/attribute method calls: leaf identifier captures emitted alongside
  // the full member-expression captures (which the namespace-derived UE
  // detection in `tree-sitter-source-parser.ts` still needs). We intentionally
  // ignore `csharp.call.member` / `lua.call.member` / `python.call.attribute`
  // here so the full-text captures never produce dependency nodes — those
  // captures' text spans entire chained expressions and would otherwise
  // create unbounded labels (and unwritable filenames).
  'csharp.call.method':    dependencyHandler(ProjectGraphEdgeKind.CALLS),
  'lua.call.method':       dependencyHandler(ProjectGraphEdgeKind.CALLS),
  'python.call.method':    dependencyHandler(ProjectGraphEdgeKind.CALLS),
};

const addDependencyFact = (
  project: DetectedProject,
  filePath: string,
  name: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  kind: ProjectGraphEdgeKind,
  capture?: ParserCapture,
): void => {
  const sanitized = sanitizeDependencyName(name);
  if (!sanitized) return;
  const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, sanitized, sanitized, evidence(filePath, capture));
  addNode(nodes, dependency);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, kind, evidence(filePath, capture)));
};

/**
 * Reject capture text that is not a single symbol-like token before it
 * becomes a DEPENDENCY node label / id seed.
 *
 * Background: tree-sitter `member_expression` / `member_access_expression`
 * / `dot_index_expression` / `attribute` capture text spans the entire
 * chained call (`bundleCommand.command(...).description(...).option(...)`).
 * Taking that as `name` poisoned the dependency node label, which is
 * later used verbatim as the node id seed, the Obsidian per-node page
 * filename slug, and the ECS retrieval haystack — and on Windows the
 * resulting filename overflowed `MAX_PATH`, killing the whole projection
 * write.
 *
 * We canonicalize "dependency name = a single symbol identifier", and
 * any capture that would violate this contract is dropped at the source
 * rather than written into the graph and patched downstream.
 */
const DEPENDENCY_NAME_MAX_LENGTH = 200;
const sanitizeDependencyName = (rawName: string): string | null => {
  const name = rawName.trim();
  if (name.length === 0) return null;
  if (name.length > DEPENDENCY_NAME_MAX_LENGTH) return null;
  if (/[\s\r\n()\[\]{}<>;]/.test(name)) return null;
  return name;
};

const addSymbolFact = (
  project: DetectedProject,
  filePath: string,
  name: string,
  kind: ProjectGraphNodeKind,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  capture: ParserCapture,
): void => {
  const symbol = makeNode(project, kind, `${filePath}#${kind}:${name}`, name, evidence(filePath, capture), {
    ownedByFile: filePath,
  });
  addNode(nodes, symbol);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), symbol.id, ProjectGraphEdgeKind.DEFINES, evidence(filePath, capture)));
};
