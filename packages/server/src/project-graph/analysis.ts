import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import { taskGuidanceFromOperationManual, type ProjectGraphTaskGuidance } from './operation-manual.js';
import { sortProjectGraphNodesBySalience } from './salience.js';

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
  project?: DetectedProject;
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
  summary: string;
  markdown: string;
  compactJson: {
    task: ProjectGraphTaskQuery;
    query?: string;
    nodeIds: string[];
    evidence: string[];
    guidance: ProjectGraphTaskGuidance[];
    suggestedNextQueries: string[];
  };
  evidence: string[];
  items: ProjectGraphTaskQueryItem[];
  guidance: ProjectGraphTaskGuidance[];
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
  const matchingNodes = nodes.filter((node) => matchesQuery(node, query));
  const taskNodes = selectTaskNodes(input.task, nodes, edges, matchingNodes);
  const selected = (input.task === 'asset-references' || input.task === 'binding'
    ? taskNodes
    : sortProjectGraphNodesBySalience(taskNodes, edges)).slice(0, limit);
  const items = selected.map(toTaskItem);
  const evidence = Array.from(new Set(items.flatMap((item) => item.evidence))).slice(0, limit);
  const suggestedNextQueries = selected.slice(0, 3).map((node) => `impact ${node.title}`);
  const guidance = input.task === 'before-edit' || input.task === 'impact'
    ? taskGuidanceFromOperationManual(input.project, input.task, input.query)
    : [];

  return {
    task: input.task,
    query: input.query,
    summary: `${input.task}: ${items.length} item(s)`,
    markdown: renderTaskMarkdown(input.task, items, guidance),
    compactJson: {
      task: input.task,
      query: input.query,
      nodeIds: selected.map((node) => node.id),
      evidence,
      guidance,
      suggestedNextQueries,
    },
    evidence,
    items,
    guidance,
    suggestedNextQueries,
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
  matchingNodes: ContextNode[],
): ContextNode[] => {
  if (task === 'entry-points') return entryPointNodes(nodes, edges);
  if (task === 'asset-references') return relatedByKinds(matchingNodes, nodes, edges, [ProjectGraphEdgeKind.REFERENCES_ASSET, ProjectGraphEdgeKind.OWNS_ASSET]);
  if (task === 'binding') {
    const bindingNodeIds = new Set(edges
      .filter((edge) => edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === ProjectGraphEdgeKind.BINDS_TO)
      .flatMap((edge) => [edge.sourceId, edge.targetId]));
    return matchingNodes.filter((node) => bindingNodeIds.has(node.id));
  }
  if (task === 'flow') return relatedByKinds(matchingNodes, nodes, edges, [
    ProjectGraphEdgeKind.ENTRYPOINT_TO,
    ProjectGraphEdgeKind.CALLS,
    ProjectGraphEdgeKind.BINDS_TO,
    ProjectGraphEdgeKind.IMPORTS,
    ProjectGraphEdgeKind.ROUTES_TO,
  ], 2);
  if (task === 'impact' || task === 'before-edit') return impactNodes(matchingNodes, nodes, edges, taskDepth(task));
  if (task === 'module') return moduleNodes(matchingNodes, nodes, edges);
  return relatedNodes(nodes, edges, matchingNodes, taskDepth(task));
};

const entryPointNodes = (nodes: ContextNode[], edges: ContextEdge[]): ContextNode[] => {
  const files = nodes.filter((node) => kindOf(node) === ProjectGraphNodeKind.FILE && node.metadata?.['generated'] !== true);
  const incomingCounts = new Map<string, number>();
  for (const edge of edges) incomingCounts.set(edge.targetId, (incomingCounts.get(edge.targetId) ?? 0) + 1);
  return files.filter((node) =>
    entryPointPathScore(node.title) > 0 || (incomingCounts.get(node.id) ?? 0) > 0);
};

const moduleNodes = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
): ContextNode[] => {
  const roots = new Set(seeds.map((node) => moduleRoot(node)).filter((root): root is string => !!root));
  const sameModule = nodes.filter((node) => {
    const root = moduleRoot(node);
    return root ? roots.has(root) : false;
  });
  return relatedNodes(nodes, edges, sameModule.length > 0 ? sameModule : seeds, 1);
};

const impactNodes = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
  depth: number,
): ContextNode[] => {
  const incomingSeeds = relatedByDirection(seeds, nodes, edges, 'incoming', depth);
  return incomingSeeds.length > seeds.length ? incomingSeeds : relatedNodes(nodes, edges, seeds, depth);
};

const relatedByKinds = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
  kinds: ProjectGraphEdgeKind[],
  depth = 1,
): ContextNode[] => relatedNodes(nodes, edges.filter((edge) => kinds.includes(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] as ProjectGraphEdgeKind)), seeds, depth);

const relatedByDirection = (
  seeds: ContextNode[],
  nodes: ContextNode[],
  edges: ContextEdge[],
  direction: 'incoming' | 'outgoing',
  depth: number,
): ContextNode[] => {
  if (seeds.length === 0) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedIds = new Set(seeds.map((node) => node.id));
  const selectedOrder = seeds.map((node) => node.id);
  const queue = seeds.map((node) => ({ id: node.id, depth: 0 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    const nextEdges = edges.filter((edge) => direction === 'incoming' ? edge.targetId === current.id : edge.sourceId === current.id);
    for (const edge of nextEdges) {
      const nextId = direction === 'incoming' ? edge.sourceId : edge.targetId;
      if (selectedIds.has(nextId) || !byId.has(nextId)) continue;
      selectedIds.add(nextId);
      selectedOrder.push(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }
  return selectedOrder.map((id) => byId.get(id)).filter((node): node is ContextNode => !!node);
};

const matchesQuery = (node: ContextNode, query: string | undefined): boolean =>
  !query || node.title.toLowerCase().includes(query) || node.id.toLowerCase().includes(query);

const taskDepth = (task: ProjectGraphTaskQuery): number => {
  if (task === 'impact' || task === 'flow' || task === 'before-edit') return 2;
  return 1;
};

const moduleRoot = (node: ContextNode): string | undefined => {
  const source = node.sourceRef ?? evidenceForNode(node)[0] ?? node.title;
  const parts = source.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts[0] === 'Plugins' && parts.length >= 4 && parts[2] === 'Source') return parts.slice(0, 4).join('/');
  if (parts[0] === 'Source' && parts.length >= 2) return parts.slice(0, 2).join('/');
  if (parts[0] === 'src' && parts.length >= 2) return parts.slice(0, 2).join('/');
  return parts[0];
};

const entryPointPathScore = (value: string): number => {
  const normalized = value.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/index.') || normalized.includes('/main.') || normalized.includes('/app.')) return 3;
  if (normalized.endsWith('package.json') || normalized.endsWith('.uproject') || normalized.endsWith('.uplugin')) return 2;
  if (normalized.endsWith('.build.cs') || normalized.endsWith('.target.cs')) return 1;
  return 0;
};

const relatedNodes = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  seeds: ContextNode[],
  depth: number,
): ContextNode[] => {
  if (seeds.length === 0) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selectedIds = new Set(seeds.map((node) => node.id));
  const selectedOrder = seeds.map((node) => node.id);
  const queue = seeds.map((node) => ({ id: node.id, depth: 0 }));

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const edge of adjacentEdges(edges, current.id)) {
      const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
      if (selectedIds.has(nextId) || !byId.has(nextId)) continue;
      selectedIds.add(nextId);
      selectedOrder.push(nextId);
      queue.push({ id: nextId, depth: current.depth + 1 });
    }
  }

  return selectedOrder.map((id) => byId.get(id)).filter((node): node is ContextNode => !!node);
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

const renderTaskMarkdown = (
  task: ProjectGraphTaskQuery,
  items: ProjectGraphTaskQueryItem[],
  guidance: ProjectGraphTaskGuidance[],
): string => [
  `### ${task}`,
  '',
  ...(items.length > 0
    ? items.map((item) => `- ${item.label} (${item.kind})`)
    : ['- No matching graph items.']),
  '',
  ...guidance.flatMap((entry) => [
    `#### ${entry.title}`,
    '',
    ...entry.items.map((item) => `- ${item}`),
    '',
  ]),
].join('\n');
