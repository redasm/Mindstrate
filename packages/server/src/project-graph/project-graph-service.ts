import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  type EvidenceRef,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { safeJson } from '../project/detection-support.js';
import {
  createProjectGraphEdgeId,
  createProjectGraphNodeId,
} from './node-id.js';
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
  extractUnrealBuildModuleInfo,
  extractUnrealBuildModuleDependencies,
  extractUnrealManifestInfo,
} from './unreal-extractor.js';
import { readUnrealAssetRegistryExport } from './unreal-asset-registry-importer.js';
import {
  readProjectGraphExtractionCache,
  writeProjectGraphExtractionCache,
  type ProjectGraphFileExtractionCache,
} from './extraction-cache.js';

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
    filesScanned: extraction.filesScanned,
    nodesExtracted: extraction.nodes.length,
    edgesExtracted: extraction.edges.length,
    ...writeResult,
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
    sourceRoots: project.graphHints?.sourceRoots,
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
    if (content !== null) addUnrealBuildFacts(project, file.path, content, nodes, edges);
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

const addUnrealAssetRegistryFacts = (
  project: DetectedProject,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const registry = readUnrealAssetRegistryExport(project.root);
  if (!registry) return;
  for (const asset of registry.assets) {
    const assetNode = makeNode(project, ProjectGraphNodeKind.COMPONENT, asset.path, asset.path, evidence(asset.path), {
      assetClass: asset.class,
      scanMode: 'metadata-only',
    });
    addNode(nodes, assetNode);
    if (asset.parent) {
      const parentNode = makeNode(project, ProjectGraphNodeKind.CLASS, asset.parent, asset.parent, evidence(asset.path), {
        assetParent: true,
      });
      addNode(nodes, parentNode);
      addEdge(edges, makeEdge(assetNode.id, parentNode.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(asset.path)));
    }
    for (const reference of asset.references ?? []) {
      const referenceNode = makeNode(project, ProjectGraphNodeKind.COMPONENT, reference, reference, evidence(asset.path), {
        scanMode: 'metadata-only',
      });
      addNode(nodes, referenceNode);
      addEdge(edges, makeEdge(assetNode.id, referenceNode.id, ProjectGraphEdgeKind.REFERENCES_ASSET, evidence(asset.path)));
    }
  }
};

const addBindingFacts = (
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const nativeSymbols = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.CLASS || node.kind === ProjectGraphNodeKind.FUNCTION);
  const scriptCallsByLabel = new Map<string, ProjectGraphNodeDto[]>();
  for (const node of nodes.values()) {
    if (node.kind !== ProjectGraphNodeKind.DEPENDENCY) continue;
    const key = normalizeSymbolName(node.label).replace(/^u/, '');
    const current = scriptCallsByLabel.get(key) ?? [];
    current.push(node);
    scriptCallsByLabel.set(key, current);
  }
  for (const native of nativeSymbols) {
    const key = normalizeSymbolName(native.label).replace(/^u/, '');
    for (const scriptCall of scriptCallsByLabel.get(key) ?? []) {
      addEdge(edges, makeEdge(native.id, scriptCall.id, ProjectGraphEdgeKind.BINDS_TO, native.evidence));
    }
  }
};

const addGeneratedBindingFacts = (
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const generatedFiles = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.FILE && node.metadata?.['generated'] === true);
  const nativeSymbols = Array.from(nodes.values())
    .filter((node) => node.kind === ProjectGraphNodeKind.CLASS || node.kind === ProjectGraphNodeKind.FUNCTION || node.kind === ProjectGraphNodeKind.TYPE);
  for (const generatedFile of generatedFiles) {
    const bindingName = generatedBindingName(generatedFile.label);
    if (!bindingName) continue;
    const source = nativeSymbols.find((node) => generatedBindingMatches(bindingName, node.label));
    if (!source) continue;
    generatedFile.metadata = {
      ...(generatedFile.metadata ?? {}),
      sourceGeneratedFrom: source.id,
    };
    addEdge(edges, makeEdge(generatedFile.id, source.id, ProjectGraphEdgeKind.GENERATED_FROM, generatedFile.evidence));
  }
};

const addUnrealBuildFacts = (
  project: DetectedProject,
  filePath: string,
  content: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const moduleInfo = extractUnrealBuildModuleInfo({ path: filePath, content });
  const moduleNode = makeUnrealModuleNode(project, moduleInfo.moduleName, evidence(filePath), {
    declaredIn: filePath,
    dependencySurface: {
      public: moduleInfo.publicDependencies,
      private: moduleInfo.privateDependencies,
    },
  });
  addNode(nodes, moduleNode);
  addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.DECLARES_MODULE, evidence(filePath), {
    declarationSource: 'build-module',
  }));
  for (const capture of extractUnrealBuildModuleDependencies({ path: filePath, content })) {
    addUnrealModuleDependencyFact(project, filePath, capture.text, moduleNode.id, nodes, edges, dependencyScopeFromCapture(capture), capture);
  }
};

const addUnrealManifestFacts = (
  project: DetectedProject,
  filePath: string,
  content: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
): void => {
  const manifest = extractUnrealManifestInfo({ path: filePath, content });
  if (!manifest) return;
  for (const moduleInfo of manifest.modules) {
    const moduleNode = makeUnrealModuleNode(project, moduleInfo.name, evidence(filePath), {
      manifestType: manifest.type,
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
      declaredIn: filePath,
    });
    addNode(nodes, moduleNode);
    addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.DECLARES_MODULE, evidence(filePath), {
      declarationSource: manifest.type === 'plugin' ? 'plugin-manifest' : 'project-manifest',
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
    }));
    addEdge(edges, makeEdge(fileNodeId(project, filePath), moduleNode.id, ProjectGraphEdgeKind.LOADS_MODULE, evidence(filePath), {
      moduleType: moduleInfo.type,
      loadingPhase: moduleInfo.loadingPhase,
    }));
  }
  for (const plugin of manifest.pluginDependencies) {
    const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, `unreal-plugin:${plugin.name}`, plugin.name, evidence(filePath), {
      unrealPlugin: true,
      enabled: plugin.enabled,
    });
    addNode(nodes, dependency);
    addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath), {
      dependencyKind: 'unreal-plugin',
      enabled: plugin.enabled,
    }));
  }
};

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

const addUnrealModuleDependencyFact = (
  project: DetectedProject,
  filePath: string,
  name: string,
  moduleNodeId: string,
  nodes: Map<string, ProjectGraphNodeDto>,
  edges: Map<string, ProjectGraphEdgeDto>,
  dependencyScope: 'public' | 'private',
  capture: ParserCapture,
): void => {
  if (!name) return;
  const dependency = makeNode(project, ProjectGraphNodeKind.DEPENDENCY, `unreal-module:${name}`, name, evidence(filePath, capture), {
    unrealModuleDependency: true,
  });
  addNode(nodes, dependency);
  const edgeMetadata = {
    dependencyKind: 'unreal-module',
    dependencyScope,
  };
  addEdge(edges, makeEdge(fileNodeId(project, filePath), dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath, capture), edgeMetadata));
  addEdge(edges, makeEdge(moduleNodeId, dependency.id, ProjectGraphEdgeKind.DEPENDS_ON, evidence(filePath, capture), edgeMetadata));
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

const makeFileNode = (
  project: DetectedProject,
  filePath: string,
  scanPlan?: ProjectGraphScanPlan,
): ProjectGraphNodeDto => makeNode(project, ProjectGraphNodeKind.FILE, filePath, filePath, evidence(filePath), {
  ownedByFile: filePath,
  ...generatedFileMetadata(filePath, scanPlan),
});

const generatedFileMetadata = (
  filePath: string,
  scanPlan: ProjectGraphScanPlan | undefined,
): Record<string, unknown> => {
  if (!scanPlan?.generatedRoots.some((root) => filePath === root || filePath.startsWith(`${root}/`))) return {};
  return {
    generated: true,
    doNotEdit: true,
    metadataOnly: true,
  };
};

const makeNode = (
  project: DetectedProject,
  kind: ProjectGraphNodeKind,
  key: string,
  label: string,
  nodeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphNodeDto => ({
  id: createProjectGraphNodeId({ project: project.name, kind, key }),
  kind,
  label,
  project: project.name,
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: nodeEvidence,
  metadata,
});

const makeUnrealModuleNode = (
  project: DetectedProject,
  name: string,
  nodeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphNodeDto => makeNode(project, ProjectGraphNodeKind.MODULE, `unreal-module:${name}`, name, nodeEvidence, {
  unrealModule: true,
  ...(metadata ?? {}),
});

const makeEdge = (
  sourceId: string,
  targetId: string,
  kind: ProjectGraphEdgeKind,
  edgeEvidence: EvidenceRef[],
  metadata?: Record<string, unknown>,
): ProjectGraphEdgeDto => ({
  id: createProjectGraphEdgeId({ sourceId, targetId, kind }),
  sourceId,
  targetId,
  kind,
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: edgeEvidence,
  metadata,
});

const addNode = (nodes: Map<string, ProjectGraphNodeDto>, node: ProjectGraphNodeDto): void => {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return;
  }
  nodes.set(node.id, {
    ...existing,
    ...node,
    evidence: mergeEvidence(existing.evidence, node.evidence),
    metadata: {
      ...(existing.metadata ?? {}),
      ...(node.metadata ?? {}),
    },
  });
};

const mergeEvidence = (left: EvidenceRef[], right: EvidenceRef[]): EvidenceRef[] => {
  const merged = new Map<string, EvidenceRef>();
  for (const ref of [...left, ...right]) {
    merged.set(JSON.stringify(ref), ref);
  }
  return Array.from(merged.values());
};

const addEdge = (edges: Map<string, ProjectGraphEdgeDto>, edge: ProjectGraphEdgeDto): void => {
  edges.set(edge.id, edge);
};

const longestMatchingRoot = (filePath: string, roots: string[]): string | undefined =>
  roots
    .filter((root) => filePath === root || filePath.startsWith(`${root}/`))
    .sort((left, right) => right.length - left.length)[0];

const evidence = (filePath: string, capture?: ParserCapture): EvidenceRef[] => [{
  path: filePath,
  startLine: capture?.startLine,
  endLine: capture?.endLine,
  captureName: capture?.name,
  locationUnavailable: capture ? false : true,
  extractorId: capture?.extractorId ?? (capture ? 'tree-sitter-source' : 'project-graph-scanner'),
}];

const fileNodeId = (project: DetectedProject, filePath: string): string =>
  createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.FILE, key: filePath });

const isUnrealBuildFile = (filePath: string): boolean =>
  filePath.endsWith('.Build.cs') || filePath.endsWith('.Target.cs');

const isUnrealManifestFile = (filePath: string): boolean =>
  filePath.endsWith('.uproject') || filePath.endsWith('.uplugin');

const dependencyScopeFromCapture = (capture: ParserCapture): 'public' | 'private' =>
  capture.name.includes('.private-') ? 'private' : 'public';

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, '');

const generatedBindingName = (filePath: string): string | undefined => {
  const base = path.basename(filePath).replace(/\.[^.]+$/, '');
  return base || undefined;
};

const generatedBindingMatches = (bindingName: string, symbolName: string): boolean => {
  const normalizedBinding = normalizeSymbolName(bindingName);
  const normalizedSymbol = normalizeSymbolName(symbolName);
  return normalizedBinding === normalizedSymbol
    || normalizedBinding.replace(/^u/, '') === normalizedSymbol.replace(/^u/, '');
};

const normalizeSymbolName = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
