import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface ProjectGraphViews {
  dependencies: string[];
  assets: string[];
  bindings: Array<{ native: string; script: string }>;
}

export const collectProjectGraphViews = (
  store: ContextGraphStore,
  project: string,
): ProjectGraphViews => {
  const nodes = store.listNodes({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }).filter(isProjectGraphNode);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = store.listEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }).filter(isProjectGraphEdge);

  return {
    dependencies: uniqueSorted(nodes
      .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphNodeKind.DEPENDENCY)
      .map((node) => node.title)),
    assets: uniqueSorted(nodes
      .filter((node) => node.metadata?.['scanMode'] === 'metadata-only' && typeof node.metadata?.['assetClass'] === 'string')
      .map((node) => node.title)),
    bindings: edges
      .filter((edge) =>
        edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.BINDS_TO
        || edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.EXPORTS)
      .map((edge) => ({
        native: nodeById.get(edge.sourceId)?.title ?? edge.sourceId,
        script: nodeById.get(edge.targetId)?.title ?? edge.targetId,
      }))
      .sort((left, right) => `${left.native}:${left.script}`.localeCompare(`${right.native}:${right.script}`)),
  };
};

const uniqueSorted = (values: string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
