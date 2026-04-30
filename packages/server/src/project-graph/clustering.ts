import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  type ContextNode,
  isProjectGraphNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface ProjectGraphModule {
  id: string;
  label: string;
  files: string[];
  nodes: string[];
}

export const collectProjectGraphModules = (
  store: ContextGraphStore,
  project: string,
): ProjectGraphModule[] => {
  const nodes = store.listNodes({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }).filter(isProjectGraphNode);
  const modules = new Map<string, ProjectGraphModule>();

  for (const node of nodes) {
    const filePath = filePathForNode(node);
    if (!filePath) continue;
    const moduleRoot = moduleRootForPath(filePath);
    if (!moduleRoot) continue;
    const id = `module:${moduleRoot.toLowerCase()}`;
    const module = modules.get(id) ?? {
      id,
      label: moduleRoot,
      files: [],
      nodes: [],
    };
    if (!module.files.includes(filePath)) module.files.push(filePath);
    module.nodes.push(node.id);
    modules.set(id, module);
  }

  return Array.from(modules.values())
    .map((module) => ({
      ...module,
      files: module.files.sort((left, right) => left.localeCompare(right)),
      nodes: module.nodes.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const filePathForNode = (node: ContextNode): string | undefined => {
  const ownedByFile = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.ownedByFile];
  if (typeof ownedByFile === 'string') return ownedByFile;
  if (node.sourceRef) return node.sourceRef;
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (!Array.isArray(evidence)) return undefined;
  const first = evidence.find((entry) => entry && typeof entry === 'object' && 'path' in entry);
  return first && typeof first === 'object' && 'path' in first
    ? String((first as Record<string, unknown>).path)
    : undefined;
};

const moduleRootForPath = (filePath: string): string | undefined => {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0] === 'Plugins' && parts.length >= 4 && parts[2] === 'Source') {
    return parts.slice(0, 4).join('/');
  }
  if (parts[0] === 'Source' && parts.length >= 2) {
    return parts.slice(0, 2).join('/');
  }
  if (parts[0] === 'src' && parts.length >= 2) {
    return parts.slice(0, 2).join('/');
  }
  return parts[0];
};
