import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';

export interface ProjectGraphAnalysisInput {
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface ProjectGraphPathInput extends ProjectGraphAnalysisInput {
  from: string;
  to: string;
  maxDepth?: number;
}

export interface ProjectGraphPathResult {
  found: boolean;
  nodes: ContextNode[];
  edges: ContextEdge[];
}

export interface ProjectGraphBlastRadiusInput extends ProjectGraphAnalysisInput {
  id: string;
  depth?: number;
  limit?: number;
}

export interface ProjectGraphBlastRadiusResult {
  root: ContextNode | null;
  affectedNodes: ContextNode[];
  edges: ContextEdge[];
}

export type ProjectGraphTaskQuery =
  | 'entry-points'
  | 'module'
  | 'before-edit'
  | 'binding'
  | 'asset-references'
  | 'flow'
  | 'impact'
  | 'explain';

export interface ProjectGraphTaskQueryInput extends ProjectGraphAnalysisInput {
  task: ProjectGraphTaskQuery;
  query?: string;
  limit?: number;
}

export interface ProjectGraphTaskQueryItem {
  id: string;
  label: string;
  kind: string;
  evidence: string[];
}

export interface ProjectGraphTaskQueryResult {
  task: ProjectGraphTaskQuery;
  query?: string;
  items: ProjectGraphTaskQueryItem[];
  suggestedNextQueries: string[];
}

export const findProjectGraphPath = (input: ProjectGraphPathInput): ProjectGraphPathResult => {
  const nodes = projectGraphNodes(input.nodes);
  const edges = projectGraphEdges(input.edges);
  const from = findNode(nodes, input.from);
  const to = findNode(nodes, input.to);
  if (!from || !to) return { found: false, nodes: [], edges: [] };
  if (from.id === to.id) return { found: true, nodes: [from], edges: [] };

  const maxDepth = Math.max(input.maxDepth ?? 6, 1);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const queue: Array<{ nodeId: string; pathNodeIds: string[]; pathEdges: ContextEdge[] }> = [{
    nodeId: from.id,
    pathNodeIds: [from.id],
    pathEdges: [],
  }];
  const seen = new Set([from.id]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.pathEdges.length >= maxDepth) continue;

    for (const candidate of adjacentEdges(edges, current.nodeId)) {
      const nextId = candidate.sourceId === current.nodeId ? candidate.targetId : candidate.sourceId;
      if (seen.has(nextId) || !byId.has(nextId)) continue;
      const pathNodeIds = [...current.pathNodeIds, nextId];
      const pathEdges = [...current.pathEdges, candidate];
      if (nextId === to.id) {
        return {
          found: true,
          nodes: pathNodeIds.map((id) => byId.get(id)!),
          edges: pathEdges,
        };
      }
      seen.add(nextId);
      queue.push({ nodeId: nextId, pathNodeIds, pathEdges });
    }
  }

  return { found: false, nodes: [], edges: [] };
};

export const estimateProjectGraphBlastRadius = (
  input: ProjectGraphBlastRadiusInput,
): ProjectGraphBlastRadiusResult => {
  const nodes = projectGraphNodes(input.nodes);
  const edges = projectGraphEdges(input.edges);
  const root = findNode(nodes, input.id);
  if (!root) return { root: null, affectedNodes: [], edges: [] };

  const depth = Math.max(input.depth ?? 1, 1);
  const limit = Math.max(input.limit ?? 20, 1);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([root.id]);
  const edgeById = new Map<string, ContextEdge>();
  const affected: ContextNode[] = [];
  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: root.id, depth: 0 }];

  while (queue.length > 0 && affected.length < limit) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;

    for (const candidate of adjacentEdges(edges, current.nodeId)) {
      edgeById.set(candidate.id, candidate);
      const nextId = candidate.sourceId === current.nodeId ? candidate.targetId : candidate.sourceId;
      const next = byId.get(nextId);
      if (!next || seen.has(nextId)) continue;
      seen.add(nextId);
      affected.push(next);
      if (affected.length >= limit) break;
      queue.push({ nodeId: nextId, depth: current.depth + 1 });
    }
  }

  return {
    root,
    affectedNodes: affected,
    edges: Array.from(edgeById.values()),
  };
};

export const queryProjectGraphTask = (
  input: ProjectGraphTaskQueryInput,
): ProjectGraphTaskQueryResult => {
  const nodes = projectGraphNodes(input.nodes);
  const edges = projectGraphEdges(input.edges);
  const limit = Math.max(input.limit ?? 10, 1);
  const query = input.query?.toLowerCase();
  const matchingNodes = nodes.filter((node) => !query || node.title.toLowerCase().includes(query) || node.id.toLowerCase().includes(query));
  const selected = selectTaskNodes(input.task, matchingNodes, edges).slice(0, limit);

  return {
    task: input.task,
    query: input.query,
    items: selected.map(toTaskItem),
    suggestedNextQueries: selected.slice(0, 3).map((node) => `impact ${node.title}`),
  };
};

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter(isProjectGraphNode);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter(isProjectGraphEdge);

const findNode = (nodes: ContextNode[], id: string): ContextNode | undefined =>
  nodes.find((node) => node.id === id || node.title === id || node.sourceRef === id);

const adjacentEdges = (edges: ContextEdge[], nodeId: string): ContextEdge[] =>
  edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);

const selectTaskNodes = (
  task: ProjectGraphTaskQuery,
  nodes: ContextNode[],
  edges: ContextEdge[],
): ContextNode[] => {
  if (task === 'entry-points') return nodes.filter((node) => kindOf(node) === ProjectGraphNodeKind.FILE);
  if (task === 'asset-references') return nodes.filter((node) => kindOf(node) === ProjectGraphNodeKind.COMPONENT);
  if (task === 'binding') {
    const bindingNodeIds = new Set(edges
      .filter((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.BINDS_TO)
      .flatMap((edge) => [edge.sourceId, edge.targetId]));
    return nodes.filter((node) => bindingNodeIds.has(node.id));
  }
  return nodes;
};

const toTaskItem = (node: ContextNode): ProjectGraphTaskQueryItem => ({
  id: node.id,
  label: node.title,
  kind: kindOf(node),
  evidence: evidenceForNode(node),
});

const kindOf = (node: ContextNode): string =>
  String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown');

const evidenceForNode = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (!Array.isArray(evidence)) return node.sourceRef ? [node.sourceRef] : [node.title];
  return evidence
    .map((entry) => entry && typeof entry === 'object' && 'path' in entry ? String((entry as Record<string, unknown>).path) : '')
    .filter(Boolean);
};
