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
import type { ParserCapture } from './parser-adapter.js';
import {
  buildProjectGraphScanPlan,
  scanProjectFiles,
  type ProjectGraphScanPlan,
  type ProjectGraphScanProgress,
} from './scanner.js';
import { createTreeSitterSourceParser } from './tree-sitter-source-parser.js';
import {
  writeProjectGraphExtraction,
  type ProjectGraphExtractionResult,
  type ProjectGraphWriteResult,
} from './graph-writer.js';

export interface ProjectGraphIndexResult extends ProjectGraphWriteResult {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
}

export interface ProjectGraphIndexOptions {
  onScanProgress?: (event: ProjectGraphScanProgress) => void;
}

export const indexProjectGraph = (
  store: ContextGraphStore,
  project: DetectedProject,
  options: ProjectGraphIndexOptions = {},
): ProjectGraphIndexResult => {
  const extraction = buildProjectGraphExtraction(project, options);
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
}

const buildProjectGraphExtraction = (
  project: DetectedProject,
  options: ProjectGraphIndexOptions,
): ProjectGraphExtractionWithStats => {
  const scanOptions = {
    sourceRoots: project.graphHints?.sourceRoots,
    ignore: project.graphHints?.ignore,
    generatedRoots: project.graphHints?.generatedRoots,
    metadataOnlyRoots: project.graphHints?.layers
      ?.filter((layer) => layer.parserAdapters.includes('unreal-asset-metadata'))
      .flatMap((layer) => layer.roots),
    manifests: project.graphHints?.manifests,
    onProgress: options.onScanProgress,
  };
  const scanPlan = buildProjectGraphScanPlan(project.root, scanOptions);
  const files = scanProjectFiles(project.root, scanOptions);
  const nodes = new Map<string, ProjectGraphNodeDto>();
  const edges = new Map<string, ProjectGraphEdgeDto>();
  const sourceParser = createTreeSitterSourceParser();

  addScanPlanFacts(project, scanPlan, nodes, edges);
  for (const file of files) {
    addNode(nodes, makeFileNode(project, file.path));
    addFileContainmentFact(project, file.path, scanPlan, nodes, edges);
    if (file.path === 'package.json') {
      addPackageFacts(project, file.path, nodes, edges);
    }
    if (file.language && sourceParser.languages.includes(file.language as never)) {
      const content = readSourceFile(file.absolutePath);
      if (content === null) continue;
      const parsed = sourceParser.parse({
        path: file.path,
        language: file.language,
        content,
      });
      addSourceFacts(project, file.path, parsed.captures, nodes, edges);
    }
  }

  return {
    project: project.name,
    filesScanned: files.length,
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
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
    const manifestNode = makeFileNode(project, manifest);
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
    } else if (capture.name === 'react.component') {
      addSymbolFact(project, filePath, capture.text, ProjectGraphNodeKind.COMPONENT, nodes, edges, capture);
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

const makeFileNode = (project: DetectedProject, filePath: string): ProjectGraphNodeDto =>
  makeNode(project, ProjectGraphNodeKind.FILE, filePath, filePath, evidence(filePath), { ownedByFile: filePath });

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

const makeEdge = (
  sourceId: string,
  targetId: string,
  kind: ProjectGraphEdgeKind,
  edgeEvidence: EvidenceRef[],
): ProjectGraphEdgeDto => ({
  id: createProjectGraphEdgeId({ sourceId, targetId, kind }),
  sourceId,
  targetId,
  kind,
  provenance: ProjectGraphProvenance.EXTRACTED,
  evidence: edgeEvidence,
});

const addNode = (nodes: Map<string, ProjectGraphNodeDto>, node: ProjectGraphNodeDto): void => {
  nodes.set(node.id, node);
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
  extractorId: capture ? 'tree-sitter-source' : 'project-graph-scanner',
  captureName: capture?.name,
}];

const fileNodeId = (project: DetectedProject, filePath: string): string =>
  createProjectGraphNodeId({ project: project.name, kind: ProjectGraphNodeKind.FILE, key: filePath });

const stripQuotes = (value: string): string => value.replace(/^['"]|['"]$/g, '');
