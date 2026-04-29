import {
  ChangeSource,
  type ChangeSet,
  type ChangedFile,
  type ContextNode,
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
  riskHints: string[];
  suggestedQueries: string[];
}

export interface ProjectGraphChangeStore {
  listContextNodes?: (options?: { project?: string; limit?: number }) => ContextNode[];
  listNodes?: (options?: { project?: string; limit?: number }) => ContextNode[];
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
  const changedFiles = changeSet.files.map(normalizeChangedFile);
  const nodes = listChangeStoreNodes(store, { project: project.name, limit: 100000 })
    .filter((node) => node.metadata?.['projectGraph'] === true);
  const affectedNodeIds = nodes
    .filter((node) => changedFiles.some((file) => nodeMatchesFile(node, file.path)))
    .map((node) => node.id);
  const affectedLayers = unique(changedFiles.map((file) => file.layerId).filter(isString));
  const riskHints = generatedFileTouched(project, changedFiles)
    ? project.graphHints?.riskHints ?? []
    : [];

  return {
    changeSet: {
      ...changeSet,
      files: changedFiles,
    },
    affectedNodeIds,
    affectedLayers,
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

const nodeMatchesFile = (node: ContextNode, filePath: string): boolean =>
  node.title === filePath ||
  node.sourceRef === filePath ||
  node.metadata?.['ownedByFile'] === filePath;

const listChangeStoreNodes = (
  store: ProjectGraphChangeStore,
  options: { project?: string; limit?: number },
): ContextNode[] => {
  if (store.listNodes) return store.listNodes(options);
  if (store.listContextNodes) return store.listContextNodes(options);
  return [];
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

const suggestedQueries = (files: ChangedFile[]): string[] =>
  files.slice(0, 5).map((file) => `mindstrate graph context ${file.path}`);

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));
const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const normalizePath = (value: string): string => value.replace(/\\/g, '/');
