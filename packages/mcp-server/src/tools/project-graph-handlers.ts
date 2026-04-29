import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectGraphOverlaySource,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlayKind,
} from '@mindstrate/protocol';
import type { McpApi, McpToolResponse } from '../types.js';
import {
  evidencePaths,
  formatProjectGraphEdges,
  formatProjectGraphNodes,
  formatProjectGraphOverlays,
} from './project-graph-render.js';

type ToolInput = any;

export async function handleProjectGraphQuery(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    query: input.query,
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: input.limit ?? 10,
  }));

  if (nodes.length === 0) {
    return { content: [{ type: 'text', text: 'No project graph nodes matched the query.' }] };
  }
  return { content: [{ type: 'text', text: formatProjectGraphNodes(nodes) }] };
}

export async function handleProjectGraphGetNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  return { content: [{ type: 'text', text: formatProjectGraphNodes([node]) }] };
}

export async function handleProjectGraphGetNeighbors(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const limit = input.limit ?? 20;
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit }));
  const text = [
    formatProjectGraphNodes([node]),
    '',
    '### Outgoing Edges',
    formatProjectGraphEdges(outgoing),
    '',
    '### Incoming Edges',
    formatProjectGraphEdges(incoming),
    '',
    'Suggested next queries:',
    `- explain_project_graph_node id="${node.id}"`,
    '- query_project_graph query="entry points"',
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphExplainNode(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const node = await findProjectGraphNode(api, input.id, input.project);
  if (!node) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };
  const outgoing = projectGraphEdges(await api.listContextEdges({ sourceId: node.id, limit: 20 }));
  const incoming = projectGraphEdges(await api.listContextEdges({ targetId: node.id, limit: 20 }));
  const overlays = await api.listProjectGraphOverlays({ project: node.project, targetNodeId: node.id, limit: 20 });
  const text = [
    `### ${node.title}`,
    `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
    `Provenance: ${node.metadata?.['provenance'] ?? 'unknown'}`,
    `Evidence: ${evidencePaths(node).join(', ') || '(none)'}`,
    `Incoming project graph edges: ${incoming.length}`,
    `Outgoing project graph edges: ${outgoing.length}`,
    '',
    '### Overlays',
    formatProjectGraphOverlays(overlays),
    '',
    'Suggested next queries:',
    `- get_project_graph_neighbors id="${node.id}"`,
    `- query_project_graph query="${node.title}"`,
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphPath(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const path = shortestProjectGraphPath(nodes, edges, input.from, input.to, input.maxDepth ?? 6);
  if (!path) return { content: [{ type: 'text', text: 'No project graph path found.' }] };
  const text = [
    `Found project graph path with ${path.nodes.length} node(s).`,
    '',
    ...path.nodes.map((node, index) => [
      `### ${index + 1}. ${node.title}`,
      `ID: ${node.id}`,
      `Kind: ${node.metadata?.['kind'] ?? 'unknown'}`,
      path.edges[index] ? `Next edge: ${path.edges[index].evidence?.['kind'] ?? path.edges[index].relationType}` : null,
    ].filter(Boolean).join('\n')),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphBlastRadius(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const nodes = projectGraphNodes(await api.queryContextGraph({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }));
  const edges = projectGraphEdges(await api.listContextEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }));
  const root = findProjectGraphNodeInList(nodes, input.id);
  if (!root) return { content: [{ type: 'text', text: 'Project graph node not found.' }], isError: true };

  const affected = collectBlastRadius(nodes, edges, root.id, input.depth ?? 1, input.limit ?? 20);
  const text = [
    `### Blast Radius: ${root.title}`,
    `Affected nodes: ${affected.nodes.length}`,
    `Edges: ${affected.edges.length}`,
    '',
    formatProjectGraphNodes(affected.nodes),
    '',
    '### Connecting Edges',
    formatProjectGraphEdges(affected.edges),
  ].join('\n');
  return { content: [{ type: 'text', text }] };
}

export async function handleProjectGraphAddOverlay(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const overlay = await api.createProjectGraphOverlay({
    project: input.project,
    targetNodeId: input.targetNodeId,
    targetEdgeId: input.targetEdgeId,
    kind: input.kind as ProjectGraphOverlayKind,
    content: input.content,
    author: input.author,
    source: input.source ?? ProjectGraphOverlaySource.MCP,
  });

  return {
    content: [{
      type: 'text',
      text: [
        'Project graph overlay added.',
        `ID: ${overlay.id}`,
        `Project: ${overlay.project}`,
        overlay.targetNodeId ? `Target node: ${overlay.targetNodeId}` : null,
        overlay.targetEdgeId ? `Target edge: ${overlay.targetEdgeId}` : null,
        `Kind: ${overlay.kind}`,
        `Source: ${overlay.source}`,
      ].filter(Boolean).join('\n'),
    }],
  };
}

const findProjectGraphNode = async (
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

const projectGraphNodes = (nodes: ContextNode[]): ContextNode[] =>
  nodes.filter(isProjectGraphNode);

const projectGraphEdges = (edges: ContextEdge[]): ContextEdge[] =>
  edges.filter(isProjectGraphEdge);

const findProjectGraphNodeInList = (nodes: ContextNode[], id: string): ContextNode | undefined =>
  nodes.find((node) => node.id === id || node.title === id || node.sourceRef === id);

const shortestProjectGraphPath = (
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

const collectBlastRadius = (
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

const adjacentProjectGraphEdges = (edges: ContextEdge[], nodeId: string): ContextEdge[] =>
  edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
