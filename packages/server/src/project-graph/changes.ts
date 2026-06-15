import {
  ChangeSource,
  MAX_PROJECT_GRAPH_CHANGESET_FILES,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphNodeKind,
  isProjectGraphNode,
  type ChangeSet,
  type ChangedFile,
  type ContextNode,
  type ProjectGraphExternalChangeMarker,
} from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';

export interface ProjectGraphChangeDetectionInput {
  source: ChangeSource;
  files: string[];
}

export interface ProjectGraphChangeDetectionResult {
  changeSet: ChangeSet;
  affectedNodeIds: string[];
  affectedLayers: string[];
  changeTypes: string[];
  doNotEdit: string[];
  requiredSearches: string[];
  recommendedValidation: string[];
  riskHints: string[];
  suggestedQueries: string[];
}

export interface ProjectGraphChangeStore {
  listNodes(options?: { project?: string; limit?: number }): ContextNode[];
}

export const detectProjectGraphChanges = (
  store: ProjectGraphChangeStore,
  project: DetectedProject,
  input: ProjectGraphChangeDetectionInput,
): ProjectGraphChangeDetectionResult => {
  const changedFiles = input.files.map((file) => toChangedFile(project, file));
  return detectProjectGraphChangeSet(store, project, {
    source: input.source,
    files: changedFiles,
  });
};

export const detectProjectGraphChangeSet = (
  store: ProjectGraphChangeStore,
  project: DetectedProject,
  changeSet: ChangeSet,
): ProjectGraphChangeDetectionResult => {
  if (changeSet.files.length > MAX_PROJECT_GRAPH_CHANGESET_FILES) {
    throw new Error(`ChangeSet files cannot exceed ${MAX_PROJECT_GRAPH_CHANGESET_FILES} entries.`);
  }
  const changedFiles = changeSet.files.map(normalizeChangedFile);
  const nodes = store.listNodes({ project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter(isProjectGraphNode);
  const affectedNodeIds = nodes
    .filter((node) => changedFiles.some((file) => projectGraphNodeMatchesFile(node, file.path)))
    .map((node) => node.id);
  const affectedLayers = unique(changedFiles.map((file) => file.layerId).filter(isString));
  const changeTypes = classifyChangedFiles(project, changedFiles);
  const riskHints = unique([
    ...(generatedFileTouched(project, changedFiles) ? project.graphHints?.riskHints ?? [] : []),
    ...riskHintsForChangeTypes(changeTypes),
    ...stalenessRiskHints(nodes, new Set(affectedNodeIds)),
  ]);

  return {
    changeSet: {
      ...changeSet,
      files: changedFiles,
    },
    affectedNodeIds,
    affectedLayers,
    changeTypes,
    doNotEdit: doNotEditForChangeTypes(project, changeTypes),
    requiredSearches: requiredSearchesForChangeTypes(changeTypes),
    recommendedValidation: validationForChangeTypes(changeTypes),
    riskHints,
    suggestedQueries: suggestedQueries(changedFiles),
  };
};

const toChangedFile = (project: DetectedProject, filePath: string): ChangedFile => ({
  path: normalizePath(filePath),
  status: 'modified',
  layerId: layerForPath(project, filePath),
});

const normalizeChangedFile = (file: ChangedFile): ChangedFile => ({
  ...file,
  path: normalizePath(file.path),
  oldPath: file.oldPath ? normalizePath(file.oldPath) : undefined,
});

export const projectGraphNodeMatchesFile = (node: ContextNode, filePath: string): boolean =>
  normalizePath(node.title) === filePath ||
  normalizePath(node.sourceRef ?? '') === filePath ||
  normalizePath(String(node.metadata?.['ownedByFile'] ?? '')) === filePath;

/** Read and validate a node's external-change staleness marker, if any. */
export const readExternalChangeMarker = (node: ContextNode): ProjectGraphExternalChangeMarker | null => {
  const raw = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.externalChanges];
  if (!raw || typeof raw !== 'object') return null;
  const marker = raw as Partial<ProjectGraphExternalChangeMarker>;
  if (typeof marker.pendingChanges !== 'number' || marker.pendingChanges <= 0) return null;
  return {
    pendingChanges: marker.pendingChanges,
    lastSource: marker.lastSource as ChangeSource,
    lastExternalRef: typeof marker.lastExternalRef === 'string' ? marker.lastExternalRef : undefined,
    lastChangedAt: typeof marker.lastChangedAt === 'string' ? marker.lastChangedAt : '',
  };
};

const layerForPath = (project: DetectedProject, filePath: string): string | undefined => {
  const rel = normalizePath(filePath);
  const layer = project.graphHints?.layers?.find((candidate) =>
    candidate.roots.some((root) => rel === normalizePath(root) || rel.startsWith(`${normalizePath(root)}/`)));
  return layer?.id;
};

const generatedFileTouched = (project: DetectedProject, files: ChangedFile[]): boolean =>
  files.some((file) => project.graphHints?.generatedRoots?.some((root) =>
    file.path === normalizePath(root) || file.path.startsWith(`${normalizePath(root)}/`)));

const classifyChangedFiles = (project: DetectedProject, files: ChangedFile[]): string[] => {
  const values = new Set<string>();
  for (const file of files) {
    const rel = normalizePath(file.path).toLowerCase();
    if (project.graphHints?.generatedRoots?.some((root) => rel === normalizePath(root).toLowerCase() || rel.startsWith(`${normalizePath(root).toLowerCase()}/`))) values.add('generated-output');
    if (rel.endsWith('.uproject')) values.add('project-manifest');
    if (rel.endsWith('.uplugin')) values.add('plugin-manifest');
    if (rel.endsWith('.build.cs')) values.add('build-module');
    if (rel.includes('/config/') || rel.endsWith('.ini')) values.add('config-sensitive');
    if (rel.includes('/content/') || rel.startsWith('content/')) values.add('asset-reference-sensitive');
    if (rel.includes('/typescript/') || rel.startsWith('typescript/') || rel.endsWith('.ts') || rel.endsWith('.tsx')) values.add('typescript-consumer');
    if ((rel.includes('/source/') || rel.startsWith('source/')) && (rel.endsWith('.h') || rel.endsWith('.cpp'))) values.add('cpp-source');
    if (rel.includes('editor')) values.add('editor-boundary');
  }
  if (values.size === 0 && files.length > 0) values.add('general-source');
  return Array.from(values);
};

/**
 * Surface external-change staleness markers (written by repo scanners
 * between reindex runs) for the nodes this change set touches, plus the
 * project-level marker. Turns silent graph drift into an explicit caveat
 * on every before-edit / impact analysis.
 */
const stalenessRiskHints = (nodes: ContextNode[], affectedNodeIds: Set<string>): string[] => {
  const hints: string[] = [];
  const staleAffected = nodes
    .filter((node) => affectedNodeIds.has(node.id))
    .map((node) => ({ node, marker: readExternalChangeMarker(node) }))
    .filter((entry): entry is { node: ContextNode; marker: ProjectGraphExternalChangeMarker } => entry.marker !== null);
  if (staleAffected.length > 0) {
    const names = staleAffected.slice(0, 3).map(({ node, marker }) => `"${node.title}" (${marker.pendingChanges})`);
    const suffix = staleAffected.length > 3 ? ` and ${staleAffected.length - 3} more` : '';
    hints.push(
      `Project graph may be stale for ${names.join(', ')}${suffix}: upstream changes were seen after the last index. Re-run graph indexing for fresh impact analysis.`,
    );
  }
  const projectMarker = nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.PROJECT)
    .map(readExternalChangeMarker)
    .find((marker) => marker !== null);
  if (projectMarker) {
    hints.push(
      `Project graph was indexed before ${projectMarker.pendingChanges} upstream change event(s) (last: ${projectMarker.lastExternalRef ?? 'unknown'} at ${projectMarker.lastChangedAt}). Conclusions may be outdated until reindex.`,
    );
  }
  return hints;
};

const riskHintsForChangeTypes = (changeTypes: string[]): string[] => {
  const values = new Set<string>();
  if (changeTypes.includes('generated-output')) values.add('Generated output changed; identify the source of truth before editing or committing.');
  if (changeTypes.includes('project-manifest') || changeTypes.includes('plugin-manifest')) values.add('Manifest changes can alter enabled plugins, module load phase, and startup behavior.');
  if (changeTypes.includes('build-module')) values.add('Build.cs changes can introduce missing plugin dependencies or Runtime/Editor dependency pollution.');
  if (changeTypes.includes('editor-boundary')) values.add('Check that Runtime modules do not depend on editor-only modules.');
  if (changeTypes.includes('asset-reference-sensitive')) values.add('Content asset paths may be soft-referenced; avoid plain filesystem rename.');
  return Array.from(values);
};

const doNotEditForChangeTypes = (project: DetectedProject, changeTypes: string[]): string[] =>
  changeTypes.includes('generated-output')
    ? project.graphHints?.generatedRoots ?? []
    : [];

const requiredSearchesForChangeTypes = (changeTypes: string[]): string[] => {
  const values = new Set<string>(['direct callers/importers of changed files']);
  if (changeTypes.includes('generated-output') || changeTypes.includes('typescript-consumer')) values.add('source files or generator inputs that produce changed generated declarations');
  if (changeTypes.includes('build-module') || changeTypes.includes('plugin-manifest') || changeTypes.includes('project-manifest')) values.add('.uproject, .uplugin, and Build.cs dependency consistency');
  if (changeTypes.includes('editor-boundary')) values.add('Runtime versus Editor module dependency direction');
  if (changeTypes.includes('config-sensitive')) values.add('classes, modules, or plugins referenced from config');
  if (changeTypes.includes('asset-reference-sensitive')) values.add('Asset Registry soft/hard references');
  return Array.from(values);
};

const validationForChangeTypes = (changeTypes: string[]): string[] => {
  const values = new Set<string>();
  if (changeTypes.includes('cpp-source') || changeTypes.includes('build-module')) values.add('Unreal build compile for the affected target.');
  if (changeTypes.includes('generated-output') || changeTypes.includes('typescript-consumer')) values.add('Run type generation or TypeScript validation for affected generated declarations/consumers.');
  if (changeTypes.includes('project-manifest') || changeTypes.includes('plugin-manifest')) values.add('Validate plugin dependency consistency and editor/runtime startup.');
  if (changeTypes.includes('config-sensitive')) values.add('Validate config load for the affected target.');
  if (changeTypes.includes('asset-reference-sensitive')) values.add('Run Unreal-aware asset reference validation.');
  if (values.size === 0) values.add('Run the smallest build/test command covering the changed files.');
  return Array.from(values);
};

const suggestedQueries = (files: ChangedFile[]): string[] =>
  files.slice(0, 5).map((file) => `mindstrate graph context ${file.path}`);

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const normalizePath = (value: string): string => value.replace(/\\/g, '/');
