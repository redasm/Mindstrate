import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  type ContextNode,
  isProjectGraphEdge,
  isProjectGraphNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';

export interface ProjectGraphModuleRelation {
  kind: string;
  targetLabel: string;
  targetSlug: string;
}

export interface ProjectGraphModule {
  id: string;
  label: string;
  files: string[];
  nodes: string[];
  relations: ProjectGraphModuleRelation[];
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
      relations: [],
    };
    if (!module.files.includes(filePath)) module.files.push(filePath);
    module.nodes.push(node.id);
    modules.set(id, module);
  }

  const moduleByNodeId = new Map<string, ProjectGraphModule>();
  for (const module of modules.values()) {
    for (const nodeId of module.nodes) moduleByNodeId.set(nodeId, module);
  }
  const relationKeys = new Set<string>();
  for (const edge of store.listEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }).filter(isProjectGraphEdge)) {
    const source = moduleByNodeId.get(edge.sourceId);
    const target = moduleByNodeId.get(edge.targetId);
    if (!source || !target || source.id === target.id) continue;
    const kind = String(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? edge.relationType);
    const key = `${source.id}:${kind}:${target.id}`;
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);
    source.relations.push({
      kind,
      targetLabel: target.label,
      targetSlug: slugifyProjectGraphValue(target.label),
    });
  }

  return Array.from(modules.values())
    .map((module) => ({
      ...module,
      files: module.files.sort((left, right) => left.localeCompare(right)),
      nodes: module.nodes.sort((left, right) => left.localeCompare(right)),
      relations: module.relations.sort((left, right) =>
        `${left.kind}:${left.targetLabel}`.localeCompare(`${right.kind}:${right.targetLabel}`)),
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
    const area = parts[1].includes('.') ? parts[1].replace(/\.[^.]+$/, '') : parts[1];
    return ['src', area].join('/');
  }
  return parts[0];
};
