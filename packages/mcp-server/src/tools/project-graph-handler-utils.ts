/**
 * Shared helpers for project graph MCP handlers and the task report builder.
 *
 * Filtering, lookup, and neighborhood traversal that both `project-graph-handlers`
 * and `project-graph-task-report` need. Splitting these out avoids the previous
 * 700-line monolith and prevents the two files from circular-importing each
 * other.
 */

import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol';
import type { McpApi } from '../types.js';

// ============================================================
// Project graph filtering
// ============================================================

export const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter(isProjectGraphNode);

export const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter(isProjectGraphEdge);

// ============================================================
// Lookup
// ============================================================

export const findProjectGraphNodeInList = (nodes: ContextNode[], id: string): ContextNode | undefined =>
  nodes.find((node) => node.id === id || node.title === id || node.sourceRef === id);

export const findProjectGraphNode = async (
  api: McpApi,
  id: string,
  project?: string,
): Promise<ContextNode | null> => {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  return findProjectGraphNodeInList(nodes, id) ?? null;
};

// ============================================================
// Neighborhood traversal
// ============================================================

export const adjacentProjectGraphEdges = (edges: ContextEdge[], nodeId: string): ContextEdge[] =>
  edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);

export const collectRelatedNodes = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  seeds: ContextNode[],
  depth: number,
): ContextNode[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Set(seeds.map((node) => node.id));
  const queue = seeds.map((node) => ({ id: node.id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (selected.has(nextId) || !byId.has(nextId)) continue;
      selected.add(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }
  return nodes.filter((node) => selected.has(node.id));
};

export const relatedByEdgeKinds = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
  kinds: ProjectGraphEdgeKind[],
  depth = 1,
): ContextNode[] => collectRelatedNodes(
  nodes,
  edges.filter((edge) => kinds.includes(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] as ProjectGraphEdgeKind)),
  seeds,
  depth,
);

// ============================================================
// Pathfinding / blast radius
// ============================================================

export const shortestProjectGraphPath = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  from: string,
  to: string,
  maxDepth: number,
): { nodes: ContextNode[]; edges: ContextEdge[] } | null => {
  const start = findProjectGraphNodeInList(nodes, from);
  const target = findProjectGraphNodeInList(nodes, to);
  if (!start || !target) return null;
  if (start.id === target.id) return { nodes: [start], edges: [] };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([start.id]);
  const queue: Array<{ id: string; nodeIds: string[]; edges: ContextEdge[] }> = [{
    id: start.id,
    nodeIds: [start.id],
    edges: [],
  }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.edges.length >= maxDepth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (seen.has(nextId) || !byId.has(nextId)) continue;
      const nodeIds = [...current.nodeIds, nextId];
      const pathEdges = [...current.edges, edge];
      if (nextId === target.id) {
        return { nodes: nodeIds.map((id) => byId.get(id)!), edges: pathEdges };
      }
      seen.add(nextId);
      queue.push({ id: nextId, nodeIds, edges: pathEdges });
    }
  }

  return null;
};

export const collectBlastRadius = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  rootId: string,
  depth: number,
  limit: number,
): { nodes: ContextNode[]; edges: ContextEdge[] } => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([rootId]);
  const affected: ContextNode[] = [];
  const edgeById = new Map<string, ContextEdge>();
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (queue.length > 0 && affected.length < limit) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const edge of adjacentProjectGraphEdges(edges, current.id)) {
      edgeById.set(edge.id, edge);
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      const next = byId.get(nextId);
      if (!next || seen.has(nextId)) continue;
      seen.add(nextId);
      affected.push(next);
      if (affected.length >= limit) break;
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }
  return { nodes: affected, edges: Array.from(edgeById.values()) };
};
