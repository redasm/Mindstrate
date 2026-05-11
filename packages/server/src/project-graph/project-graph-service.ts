/**
 * Project graph indexing orchestrator.
 *
 * Drives the full extraction flow:
 *   1. Plan + scan the project (delegates to `scanner.ts`).
 *   2. For each scanned file, run the right extractors (generic source via
 *      tree-sitter, Unreal-specific via `unreal-fact-builder`, dependency
 *      manifests via `addPackageFacts`).
 *   3. Run second-pass binding inference (`binding-fact-builder`).
 *   4. Persist extracted nodes/edges through `graph-writer`.
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
  writeProjectGraphExtraction,
  type ProjectGraphExtractionResult,
  type ProjectGraphWriteResult,
} from './graph-writer.js';
import {
  readProjectGraphExtractionCache,
  writeProjectGraphExtractionCache,
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
import {
  addBindingFacts,
  addGeneratedBindingFacts,
} from './binding-fact-builder.js';

export interface ProjectGraphIndexResult extends ProjectGraphWriteResult {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
}

export interface ProjectGraphIndexOptions {
  onScanProgress?: (event: ProjectGraphScanProgress) => void;
  onIndexProgress?: (event: ProjectGraphIndexProgress) => void;
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
  const extraction = buildProjectGraphExtraction(project, options);
  options.onIndexProgress?.({
    phase: 'writing',
    filesProcessed: extraction.filesScanned,
    filesTotal: extraction.filesScanned,
    nodes: extraction.nodes.length,
    edges: extraction.edges.length,
    generatedFiles: extraction.generatedFiles,
    metadataOnlyRoots: extraction.metadataOnlyRoots,
    skippedFiles: extraction.skippedFiles,
  });
  const writeResult = writeProjectGraphExtraction(store, extraction);
  return {
    ...writeResult,
    filesScanned: extraction.filesScanned,
    nodesExtracted: extraction.nodes.length,
    edgesExtracted: extraction.edges.length,
  };
};

interface ProjectGraphExtractionWithStats extends ProjectGraphExtractionResult {
  filesScanned: number;
  generatedFiles: number;
  metadataOnlyRoots: number;
  skippedFiles: number;
}

interface ProjectGraphFileExtractionOutcome extends ProjectGraphExtractionResult {
  skipped: boolean;
}

const buildProjectGraphExtraction = (
  project: DetectedProject,
  options: ProjectGraphIndexOptions,
): ProjectGraphExtractionWithStats => {
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
  const nodes = new Map<string, ProjectGraphNodeDto>();
  const edges = new Map<string, ProjectGraphEdgeDto>();
  const parserAdapters = [
    createUnrealCppParserAdapter(),
    createScriptRegexParserAdapter(),
    createTreeSitterSourceParser(),
  ];
  const previousCache = readProjectGraphExtractionCache(project.root);
  const nextCache: ProjectGraphFileExtractionCache = { version: 2, files: {} };

  addScanPlanFacts(project, scanPlan, nodes, edges);
  files.forEach((file, index) => {
    addNode(nodes, makeFileNode(project, file.path, scanPlan));
    addFileContainmentFact(project, file.path, scanPlan, nodes, edges);
    const fileExtraction = extractFileFacts(project, file, parserAdapters, previousCache);
    if (fileExtraction.skipped) skippedFiles += 1;
    if (!fileExtraction.skipped) {
      nextCache.files[file.path] = {
        path: file.path,
        hash: file.hash,
        nodes: fileExtraction.nodes,
        edges: fileExtraction.edges,
      };
    }
    for (const node of fileExtraction.nodes) addNode(nodes, node);
    for (const edge of fileExtraction.edges) addEdge(edges, edge);
    emitIndexProgress(options.onIndexProgress, {
      phase: 'extracting',
      filesProcessed: index + 1,
      filesTotal: files.length,
      nodes: nodes.size,
      edges: edges.size,
      generatedFiles,
      metadataOnlyRoots,
      skippedFiles,
      path: file.path,
    });
  });
  addUnrealAssetRegistryFacts(project, nodes, edges);
  emitIndexProgress(options.onIndexProgress, {
    phase: 'binding',
    filesProcessed: files.length,
    filesTotal: files.length,
    nodes: nodes.size,
    edges: edges.size,
    generatedFiles,
    metadataOnlyRoots,
    skippedFiles,
  });
  addBindingFacts(nodes, edges);
  addGeneratedBindingFacts(nodes, edges);
  emitIndexProgress(options.onIndexProgress, {
    phase: 'cache',
    filesProcessed: files.length,
    filesTotal: files.length,
    nodes: nodes.size,
    edges: edges.size,
    generatedFiles,
    metadataOnlyRoots,
    skippedFiles,
  });
  writeProjectGraphExtractionCache(project.root, nextCache);

  return {
    project: project.name,
    filesScanned: files.length,
    generatedFiles,
    metadataOnlyRoots,
    skippedFiles,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
};

const emitIndexProgress = (
  onIndexProgress: ProjectGraphIndexOptions['onIndexProgress'],
  event: ProjectGraphIndexProgress,
): void => {
  onIndexProgress?.(event);
};

const extractFileFacts = (
  project: DetectedProject,
  file: ProjectFileInventoryEntry,
  parserAdapters: ParserAdapter[],
  previousCache: ProjectGraphFileExtractionCache,
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
  if (file.path === 'package.json') {
    addPackageFacts(project, file.path, nodes, edges);
  }
  if (isUnrealManifestFile(file.path)) {
    const content = readSourceFile(file.absolutePath);
    if (content !== null) addUnrealManifestFacts(project, file.path, content, nodes, edges);
  }
  if (isUnrealBuildFile(file.path)) {
    const content = readSourceFile(file.absolutePath);
    if (content !== null) addUnrealBuildFacts(project, file.path, content, nodes, edges, dependencyScopeFromCapture);
  }
  if (isUnrealConfigFile(file.path)) {
    const content = readSourceFile(file.absolutePath);
    if (content !== null) addUnrealConfigFacts(project, file.path, content, nodes, edges);
  }
  const matchingParsers = file.language
    ? parserAdapters.filter((parser) => parser.languages.includes(file.language as never))
    : [];
  if (matchingParsers.length > 0) {
    const content = readSourceFile(file.absolutePath);
    for (const parser of matchingParsers) {
      if (content === null) continue;
      const parsed = parseFileFacts(parser, file, content);
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
) => {
  try {
    return parser.parse({
      path: file.path,
      language: file.language ?? '',
      content,
    });
  } catch {
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
    if (capture.name === 'import.source') {
      addDependencyFact(project, filePath, stripQuotes(capture.text), nodes, edges, ProjectGraphEdgeKind.IMPORTS, capture);
    } else if (capture.name === 'export.source') {
      addDependencyFact(project, filePath, stripQuotes(capture.text), nodes, edges, ProjectGraphEdgeKind.EXPORTS, capture);
    } else if (capture.name === 'function.name') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.FUNCTION, nodes, edges, capture);
    } else if (capture.name === 'class.name') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.CLASS, nodes, edges, capture);
    } else if (capture.name === 'call.function') {
      addDependencyFact(project, filePath, capture.text, nodes, edges, ProjectGraphEdgeKind.CALLS, capture);
    } else if (capture.name === 'react.component') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.COMPONENT, nodes, edges, capture);
    } else if (capture.name === 'react.hook') {
      addDependencyFact(project, filePath, capture.text, nodes, edges, ProjectGraphEdgeKind.USES_HOOK, capture);
    } else if (capture.name === 'unreal.class') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.CLASS, nodes, edges, capture);
    } else if (capture.name === 'unreal.struct' || capture.name === 'unreal.enum') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.TYPE, nodes, edges, capture);
    } else if (capture.name === 'unreal.function') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.FUNCTION, nodes, edges, capture);
    } else if (capture.name === 'unreal.property') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.CONFIG, nodes, edges, capture);
    } else if (capture.name === 'script.import') {
      addDependencyFact(project, filePath, capture.text, nodes, edges, ProjectGraphEdgeKind.IMPORTS, capture);
    } else if (capture.name === 'script.class') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.CLASS, nodes, edges, capture);
    } else if (capture.name === 'script.function') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.FUNCTION, nodes, edges, capture);
    } else if (capture.name === 'script.ue-call') {
      addDependencyFact(project, filePath, capture.text, nodes, edges, ProjectGraphEdgeKind.CALLS, capture);
    }
  }
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
  if (!name) return;
  const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, name, name, evidence(filePath, capture));
  addNode(nodes, dependency);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, kind, evidence(filePath, capture)));
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
