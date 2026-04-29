import type { ContextEdge, ContextNode } from '@mindstrate/protocol/models';

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

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter((node) => node.metadata?.['projectGraph'] === true);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter((edge) => edge.evidence?.['projectGraph'] === true);

const findNode = (nodes: ContextNode[], id: string): ContextNode | undefined =>
  nodes.find((node) => node.id === id || node.title === id || node.sourceRef === id);

const adjacentEdges = (edges: ContextEdge[], nodeId: string): ContextEdge[] =>
  edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
