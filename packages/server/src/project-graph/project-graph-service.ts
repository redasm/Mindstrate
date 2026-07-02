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

import { createHash } from 'node:crypto';
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
  findUnscannedTopLevelDirectories,
  languageForExtension,
  scanProjectFiles,
  PROJECT_GRAPH_MAX_FILE_BYTES,
  type ProjectFileInventoryEntry,
  type ProjectGraphScanPlan,
  type ProjectGraphScanProgress,
  type ProjectGraphSkipEvent,
} from './scanner.js';
import { createTreeSitterSourceParser } from './tree-sitter-source-parser.js';
import { createUnrealCppParserAdapter } from './unreal-cpp-parser-adapter.js';
import { createScriptRegexParserAdapter } from './script-parser-adapter.js';
import {
  applyEdgeWrites,
  applyStreamedNodeWrites,
  archiveProjectGraphFileFacts,
  emptyWriteResult,
  type ProjectGraphExtractionResult,
  type ProjectGraphWriteResult,
} from './graph-writer.js';
import {
  readProjectGraphExtractionCache,
  openProjectGraphExtractionCacheWriter,
  emptyCache as emptyExtractionCache,
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

export interface ProjectGraphScanDiagnostics {
  /**
   * `restricted` when the scan only deep-scanned configured sourceRoots
   * (other top-level dirs invisible); `full-tree` when the whole directory
   * was walked with built-in ignores only.
   */
  coverage: 'restricted' | 'full-tree';
  /** sourceRoots requested by the detection rule / hints. */
  requestedSourceRoots: string[];
  /** Requested sourceRoots that did not exist on disk and were dropped. */
  missingSourceRoots: string[];
  /** Top-level dirs NOT deep-scanned because coverage is restricted. */
  unscannedTopLevelDirectories: string[];
  /** Count of skipped files grouped by reason (for "why fewer than expected"). */
  skippedByReason: Record<string, number>;
  /** A few example oversized files (path + bytes), for actionable logs. */
  oversizedExamples: Array<{ path: string; sizeBytes: number }>;
}

export interface ProjectGraphIndexResult extends ProjectGraphWriteResult {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
  skippedFiles: number;
  diagnostics: ProjectGraphScanDiagnostics;
}

export interface ProjectGraphIndexOptions {
  onScanProgress?: (event: ProjectGraphScanProgress) => void;
  onIndexProgress?: (event: ProjectGraphIndexProgress) => void;
  /** Diagnostics sink for skipped/failed files. Defaults to {@link noopLogger}. */
  logger?: Logger;
  /**
   * Writable base directory for the per-project extraction cache. When set, the
   * cache lives under `<extractionCacheDir>/<project-slug>/` instead of inside
   * the scanned tree — required when the scanned root is a read-only or
   * root-owned bind-mount (e.g. a P4 workspace the scanner cannot write to).
   */
  extractionCacheDir?: string;
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
    edgesOrphaned: stats.writeResult.edgesOrphaned + bindingResult.edgesOrphaned,
    filesScanned: stats.filesScanned,
    nodesExtracted: stats.nodeCount,
    edgesExtracted: stats.edgeCount + bindingEdges,
    skippedFiles: stats.skippedFiles,
    diagnostics: stats.diagnostics,
  };
};

export interface ReindexProjectGraphFilesResult extends ProjectGraphWriteResult {
  filesReindexed: number;
  filesRemoved: number;
  filesSkipped: number;
}

export interface ReindexProjectGraphFilesOptions {
  logger?: Logger;
}

/**
 * Incrementally re-extract a specific set of files into an already-indexed
 * project graph, then re-run binding inference.
 *
 * This is the write-path counterpart to `detectProjectGraphChangeSet` (which
 * only reads + marks staleness). A repo scanner calls it after an upstream
 * commit / changelist so the touched files' file + symbol (function / class /
 * call) nodes are rebuilt from current disk contents — without re-walking the
 * whole checkout. Files that no longer exist on disk have their owned facts
 * archived. `project.root` must point at a local checkout synced to (at least)
 * the revision being ingested, or extraction reads stale bytes.
 *
 * Idempotent: node/edge ids are deterministic, so re-running upserts. Old
 * symbols removed from a file are archived (not left dangling) via
 * `archiveProjectGraphFileFacts` before the file's fresh facts are written.
 */
export const reindexProjectGraphFiles = (
  store: ContextGraphStore,
  project: DetectedProject,
  filePaths: string[],
  options: ReindexProjectGraphFilesOptions = {},
): ReindexProjectGraphFilesResult => {
  const logger = options.logger ?? noopLogger;
  const scanPlan = buildProjectGraphScanPlan(project.root, {
    sourceRoots: projectGraphDeepRoots(project),
    ignore: project.graphHints?.ignore,
    generatedRoots: project.graphHints?.generatedRoots,
    manifests: project.graphHints?.manifests,
  });
  const parserAdapters = [
    createUnrealCppParserAdapter(),
    createScriptRegexParserAdapter(),
    createTreeSitterSourceParser(),
  ];
  // Empty previous cache: incremental reindex always re-parses the given files
  // from disk (the whole point is that they changed), so a cache hit would defeat it.
  const emptyCache: ProjectGraphFileExtractionCache = emptyExtractionCache();

  const result: ReindexProjectGraphFilesResult = {
    ...emptyWriteResult(),
    filesReindexed: 0,
    filesRemoved: 0,
    filesSkipped: 0,
  };

  const uniquePaths = Array.from(new Set(filePaths.map((file) => file.replace(/\\/g, '/')).filter(Boolean)));

  store.transaction(() => {
    for (const relPath of uniquePaths) {
      const entry = buildInventoryEntry(project.root, relPath, scanPlan);
      // File gone from disk (deleted upstream): archive its owned facts so the
      // graph doesn't keep stale symbols, and move on.
      if (!entry) {
        archiveProjectGraphFileFacts(store, { project: project.name, filePath: relPath });
        result.filesRemoved++;
        continue;
      }
      // Rebuild: archive the file's previous owned symbols first so a symbol
      // removed from the file this revision disappears instead of lingering.
      archiveProjectGraphFileFacts(store, { project: project.name, filePath: relPath });

      const fileNodes = new Map<string, ProjectGraphNodeDto>();
      const fileEdges = new Map<string, ProjectGraphEdgeDto>();
      addNode(fileNodes, makeFileNode(project, entry.path, scanPlan));
      addFileContainmentFact(project, entry.path, fileNodes, fileEdges);
      const extraction = extractFileFacts(project, entry, parserAdapters, emptyCache, logger);
      if (extraction.skipped) result.filesSkipped++;
      for (const node of extraction.nodes) addNode(fileNodes, node);
      for (const edge of extraction.edges) addEdge(fileEdges, edge);

      applyStreamedNodeWrites(store, Array.from(fileNodes.values()), new Set<string>(), result);
      applyEdgeWrites(store, Array.from(fileEdges.values()), result);
      result.filesReindexed++;
    }
  });

  // Re-run binding inference so native↔script and generated↔source edges pick up
  // the freshly (re)written symbols.
  bindProjectGraph(store, project.name);

  return result;
};

/**
 * Build a single-file inventory entry from disk, mirroring `scanner.addFileEntry`
 * (hash, language, generated flag, oversize guard). Returns null when the file is
 * missing, unreadable, or over the size cap — the caller treats null as "removed".
 */
const buildInventoryEntry = (
  root: string,
  relPath: string,
  scanPlan: ProjectGraphScanPlan,
): ProjectFileInventoryEntry | null => {
  const abs = path.join(root, relPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (PROJECT_GRAPH_MAX_FILE_BYTES > 0 && stat.size > PROJECT_GRAPH_MAX_FILE_BYTES) return null;
  let content: Buffer;
  try {
    content = fs.readFileSync(abs);
  } catch {
    return null;
  }
  const extension = path.extname(relPath);
  const generated = scanPlan.generatedRoots.some((genRoot) =>
    relPath === genRoot || relPath.startsWith(`${genRoot}/`));
  return {
    path: relPath,
    absolutePath: abs,
    size: stat.size,
    extension,
    hash: createHash('sha256').update(content).digest('hex'),
    modifiedTime: stat.mtime.toISOString(),
    language: languageForExtension(extension),
    generated,
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
  diagnostics: ProjectGraphScanDiagnostics;
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
  // Per-project extraction-cache directory under the writable data dir, when
  // configured. Keeps the scanner's state out of the scanned tree (which may be
  // a read-only / root-owned bind-mount such as a P4 workspace).
  const extractionCacheDir = options.extractionCacheDir
    ? path.join(options.extractionCacheDir, extractionCacheSlug(project.name))
    : undefined;
  let skippedFiles = 0;
  const skippedByReason: Record<string, number> = {};
  const oversizedExamples: Array<{ path: string; sizeBytes: number }> = [];
  const recordSkip = (event: ProjectGraphSkipEvent): void => {
    skippedByReason[event.reason] = (skippedByReason[event.reason] ?? 0) + 1;
    if (event.reason === 'oversized' && event.sizeBytes !== undefined && oversizedExamples.length < 5) {
      oversizedExamples.push({ path: event.path, sizeBytes: event.sizeBytes });
    }
  };
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
    onSkip: recordSkip,
  };
  const scanPlan = buildProjectGraphScanPlan(project.root, scanOptions);
  const files = scanProjectFiles(project.root, scanOptions);
  const unscannedTopLevelDirectories = findUnscannedTopLevelDirectories(project.root, scanPlan, scanOptions);
  const generatedFiles = files.filter((file) => file.generated).length;
  const metadataOnlyRoots = scanOptions.metadataOnlyRoots?.length ?? 0;
  const parserAdapters = [
    createUnrealCppParserAdapter(),
    createScriptRegexParserAdapter(),
    createTreeSitterSourceParser(),
  ];
  const previousCache = readProjectGraphExtractionCache(project.root, extractionCacheDir);
  const cacheWriter = openProjectGraphExtractionCacheWriter(project.root, extractionCacheDir);

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
      addFileContainmentFact(project, file.path, fileNodes, fileEdges);
      const fileExtraction = extractFileFacts(project, file, parserAdapters, previousCache, options.logger ?? noopLogger);
      if (fileExtraction.skipped) {
        skippedFiles += 1;
        skippedByReason['parser-failed'] = (skippedByReason['parser-failed'] ?? 0) + 1;
      }
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
    diagnostics: {
      coverage: scanPlan.deepRoots.length > 0 ? 'restricted' : 'full-tree',
      requestedSourceRoots: scanPlan.requestedSourceRoots,
      missingSourceRoots: scanPlan.missingSourceRoots,
      unscannedTopLevelDirectories,
      skippedByReason,
      oversizedExamples,
    },
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

/**
 * Filesystem-safe slug for a project name, used as the extraction cache's
 * per-project subdirectory under the data dir. Mirrors the vector-store slug
 * rules so a project's cache and vectors sit under matching names.
 */
const extractionCacheSlug = (project: string): string =>
  project
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'default';

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
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  // Build the full ancestor directory chain so the graph is navigable from the
  // project root down to every file. Previously a file was linked directly to
  // its nearest configured deep-root (e.g. `TypeScript`), collapsing every
  // intermediate directory (`TypeScript/Src`, `TypeScript/Src/Game`, ...) out of
  // existence — so from the root there was no path to reach a deep file, and the
  // bounded initial view could never surface it. Now each path segment becomes a
  // DIRECTORY node chained by CONTAINS: project → TypeScript → Src → Game → file.
  const parentDirId = addDirectoryChainFacts(project, filePath, nodes, edges);
  addEdge(edges, makeEdge(parentDirId, fileNodeId(project, filePath), ProjectGraphEdgeKind.CONTAINS, evidence(filePath)));
};

/**
 * Ensure a DIRECTORY node exists for every ancestor directory of `filePath`,
 * chained parent→child by CONTAINS, and return the id of the file's immediate
 * parent directory (or the project node id when the file sits at the root).
 *
 * The topmost segment is linked to the project node; deeper segments chain to
 * their parent directory. Directory nodes are keyed by their relative path,
 * matching `addDirectoryFact`, so the configured deep-root directory nodes
 * (created up-front with a scanMode marker) and re-index runs merge by id
 * rather than duplicating.
 */
const addDirectoryChainFacts = (
  project: DetectedProject,
  filePath: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): string => {
  const projectId = createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.PROJECT, key: project.name });
  const segments = filePath.split('/');
  segments.pop(); // drop the file name; only directories remain
  if (segments.length === 0) return projectId;

  let parentId = projectId;
  let accum = '';
  for (const segment of segments) {
    accum = accum ? `${accum}/${segment}` : segment;
    const dirId = createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.DIRECTORY, key: accum });
    // Only create the node if it isn't already staged this batch: deep-root
    // directory nodes are created up-front by addScanPlanFacts with a scanMode
    // marker that a bare directory fact must not clobber. addNode merges, so the
    // guard just avoids overwriting the richer root metadata.
    if (!nodes.has(dirId)) {
      addNode(nodes, makeNode(project, ProjectGraphNodeKind.DIRECTORY, accum, accum, evidence(accum)));
    }
    addEdge(edges, makeEdge(parentId, dirId, ProjectGraphEdgeKind.CONTAINS, evidence(accum)));
    parentId = dirId;
  }
  return parentId;
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
  // Pass 1: index the function-like symbols this file defines, so a call to one
  // of them can be resolved to the local FUNCTION definition node instead of an
  // anonymous DEPENDENCY node. Only function/method definitions are eligible
  // call targets (a CLASS is constructed via `new`, handled as a call too, but
  // its definition node is a CLASS — include it so `new Foo()` links to it).
  const localDefinitions = new Map<string, string>(); // symbol name -> definition node id
  for (const capture of captures) {
    const kind = LOCAL_DEFINITION_KINDS[capture.name];
    if (!kind) continue;
    const name = capture.text.trim();
    if (name.length === 0) continue;
    // First definition of a name wins; overloads/duplicates collapse to one node
    // (the symbol node id is derived from name, so they'd merge anyway).
    if (!localDefinitions.has(name)) {
      localDefinitions.set(name, symbolNodeId(project, filePath, kind, name));
    }
  }

  // Pass 2: dispatch each capture. `call.function` is resolved against the
  // local definitions first (see `addCallFact`); everything else goes straight
  // to its registered handler.
  const noiseSymbols = callNoiseSymbolsFor(project);
  for (const capture of captures) {
    if (capture.name === 'call.function') {
      addCallFact(project, filePath, capture, localDefinitions, noiseSymbols, nodes, edges);
      continue;
    }
    SOURCE_FACT_HANDLERS[capture.name]?.(project, filePath, capture, nodes, edges);
  }
};

/**
 * Resolve the call-noise symbol set for a project: the rule-provided
 * `graphHints.callNoiseSymbols` when configured (so teams can tune it per
 * project in their `.mindstrate/rules/*.json`), otherwise the built-in default.
 * An explicit empty array in the rule disables filtering entirely.
 */
const callNoiseSymbolsFor = (project: DetectedProject): Set<string> => {
  const configured = project.graphHints?.callNoiseSymbols;
  if (configured) return new Set(configured);
  return DEFAULT_CALL_NOISE_SYMBOLS;
};

/**
 * Capture names that introduce a callable symbol *defined in this file*, mapped
 * to the node kind they produce. Used by {@link addSourceFacts} pass 1 to build
 * the local call-resolution table. Mirrors the FUNCTION/CLASS entries in
 * {@link SOURCE_FACT_HANDLERS} for the ECMAScript captures.
 */
const LOCAL_DEFINITION_KINDS: Record<string, ProjectGraphNodeKind> = {
  'function.name': ProjectGraphNodeKind.FUNCTION,
  'method.name': ProjectGraphNodeKind.FUNCTION,
  'class.name': ProjectGraphNodeKind.CLASS,
};

/**
 * Resolve a `call.function` capture. When the called name matches a function /
 * class defined in the same file, emit a `CALLS` edge to that definition node —
 * this is what makes the intra-file call graph traversable ("who calls
 * `UpdateNextCustomMarkNumber`"). When it doesn't match (an imported symbol, a
 * built-in, a member call on another object), fall back to the anonymous
 * DEPENDENCY node so cross-file / native binding inference can still connect it.
 */
const addCallFact = (
  project: DetectedProject,
  filePath: string,
  capture: ParserCapture,
  localDefinitions: Map<string, string>,
  noiseSymbols: Set<string>,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const name = capture.text.trim();
  const targetId = localDefinitions.get(name);
  if (targetId) {
    // The definition's symbol node is emitted by its own handler in this same
    // pass (order-independent: both live in the file's node/edge buffer, and the
    // writer's FK guard drops the edge if the node somehow didn't materialize).
    addEdge(edges, makeEdge(fileNodeId(project, filePath), targetId, ProjectGraphEdgeKind.CALLS, evidence(filePath, capture)));
    return;
  }
  // Drop calls to language builtins / test-framework globals. These are not
  // project dependencies — treating `str`/`print`/`require`/`expect`/`it` as
  // DEPENDENCY nodes floods the graph with thousands of meaningless nodes that
  // LLM enrichment then promotes into bogus "concept" architecture nodes. A call
  // to a name we don't recognize as a local definition AND that is a known
  // builtin is noise; skip it. Real imported symbols still arrive via
  // `import.source`, and genuine cross-file calls still fall through to a
  // DEPENDENCY the binding pass can resolve. The set is configurable per project
  // via the rule's `callNoiseSymbols` (see {@link callNoiseSymbolsFor}).
  if (noiseSymbols.has(name)) return;
  addDependencyFact(project, filePath, name, nodes, edges, ProjectGraphEdgeKind.CALLS, capture);
};

/**
 * Default call targets that are language builtins or test-framework globals,
 * not project symbols. Used when a project's rule does not override
 * `graphHints.callNoiseSymbols`. Filtered out of the call graph so they don't
 * become DEPENDENCY nodes (and, downstream, LLM-inferred "concept" nodes).
 * Scoped to the languages this scanner parses (JS/TS, Python, Lua, C#, C++).
 * Deliberately conservative — only unambiguous builtins/framework globals.
 */
export const DEFAULT_CALL_NOISE_SYMBOLS = new Set<string>([
  // JS/TS language + common globals
  'require', 'super', 'import', 'typeof', 'instanceof', 'await', 'new', 'delete', 'void', 'yield',
  'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'JSON', 'Math', 'Date', 'RegExp', 'Error', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'console', 'all', 'race', 'resolve', 'reject', 'from', 'of', 'keys', 'values', 'entries',
  // Jest / Vitest / Mocha test globals
  'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
  'toEqual', 'toBe', 'toContain', 'toThrow', 'toHaveBeenCalled', 'toMatchObject', 'toBeNull',
  'toBeUndefined', 'toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toHaveLength', 'mockReturnValue',
  'vi', 'jest', 'spyOn', 'mock',
  // Python builtins
  'str', 'int', 'float', 'bool', 'bytes', 'list', 'dict', 'tuple', 'set', 'frozenset',
  'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'isinstance', 'issubclass',
  'hasattr', 'getattr', 'setattr', 'type', 'repr', 'abs', 'min', 'max', 'sum', 'sorted',
  'open', 'input', 'format', 'any',
  // Lua builtins
  'pairs', 'ipairs', 'tostring', 'tonumber', 'pcall', 'xpcall', 'select', 'rawget', 'rawset',
  'setmetatable', 'getmetatable', 'assert', 'error', 'next',
]);

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
  // Class members (methods, arrow-function fields). Captured separately from
  // `function.name` so the React-component heuristic (uppercase function → component)
  // does not misfire on an ordinary uppercase method, but modeled as the same
  // FUNCTION symbol kind.
  'method.name':     symbolHandler(ProjectGraphNodeKind.FUNCTION),
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
  const symbol = makeNode(project, kind, symbolKey(filePath, kind, name), name, evidence(filePath, capture), {
    ownedByFile: filePath,
  });
  addNode(nodes, symbol);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), symbol.id, ProjectGraphEdgeKind.DEFINES, evidence(filePath, capture)));
};

/** Key seed for a per-file symbol node (function / class / type defined in a file). */
const symbolKey = (filePath: string, kind: ProjectGraphNodeKind, name: string): string =>
  `${filePath}#${kind}:${name}`;

/** Node id for a per-file symbol, matching what {@link addSymbolFact} writes. */
const symbolNodeId = (
  project: DetectedProject,
  filePath: string,
  kind: ProjectGraphNodeKind,
  name: string,
): string => createProjectGraphNodeId({ project: project.name, kind, key: symbolKey(filePath, kind, name) });
