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

/**
 * Resolve a node by id / title / sourceRef. Looks at the standard
 * project graph nodes first (file / module / dependency / asset facts
 * produced by the extractor); falls back to architecture system-page
 * RULE nodes so callers can `get_project_graph_node id="architecture:
 * system-page:<project>:<page-key>"` (and `explain_project_graph_node`)
 * directly without being told the node does not exist.
 *
 * Both classes of nodes share `domainType: ARCHITECTURE`, so a single
 * `queryContextGraph` call returns both — we just need to widen the
 * post-filter beyond `isProjectGraphNode`.
 */
export const findProjectGraphNode = async (
  api: McpApi,
  id: string,
  project?: string,
): Promise<ContextNode | null> => {
  const nodes = await api.queryContextGraph({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  });
  const direct = findProjectGraphNodeInList(projectGraphNodes(nodes), id);
  if (direct) return direct;
  const systemPage = nodes.find((node) =>
    node.metadata?.['systemPage'] === true
      && (node.id === id || node.title === id || node.sourceRef === id),
  );
  return systemPage ?? null;
};

/**
 * Load the architecture system-page RULE nodes (the ones produced by
 * `internalize-system-pages.ts`). These are intentionally NOT
 * project-graph nodes (they describe the project at a higher level than
 * file-by-file extraction), so the regular `projectGraphNodes` filter
 * drops them. The task report consumes them to render project-specific
 * "Known Constraints" / "Do Not Edit Directly" / etc.
 */
export const loadSystemPageRules = async (api: McpApi, project?: string): Promise<ContextNode[]> => {
  const nodes = await api.queryContextGraph({
    project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  });
  return nodes.filter((node) => node.metadata?.['systemPage'] === true);
};

// ============================================================
// Path-aware seed selection
// ============================================================

/**
 * Detect whether a free-form task query looks like a file path the
 * caller wants seeded against. Treat it as a path when it contains
 * either a slash separator or one of the workspace-prefix markers we
 * know are paths (no spaces, no Chinese, no punctuation outside path
 * characters). Anything else is treated as natural language and falls
 * back to the token-includes matcher used by `selectTaskNodes`.
 */
export const looksLikeFilePath = (query: string | undefined): boolean => {
  if (typeof query !== 'string' || query.length === 0) return false;
  if (/\s/.test(query)) return false;
  return query.includes('/') || query.includes('\\');
};

/**
 * Normalize any incoming path representation (Windows backslashes,
 * absolute, workspace-relative, leaf-only) into a comparable lowercase
 * forward-slash form. Mirrors `normalizePath` in
 * `selectProjectGraphAssemblyFacts` so the two seed selectors agree on
 * what "the same path" means.
 */
const normalizeQueryPath = (value: string): string =>
  value.replace(/\\/g, '/').toLowerCase();

/**
 * Build the set of path forms a node could match against. Accepts the
 * full normalized path, the longest workspace-relative tail starting at
 * `packages/`, and the bare filename as a last-resort. The same shape
 * that `selectProjectGraphAssemblyFacts.currentFileMatchCandidates`
 * produces, kept in sync intentionally — the two selectors are reached
 * by different MCP tools but must surface the same set of seeds for a
 * given file path.
 */
const pathMatchCandidates = (query: string): string[] => {
  const normalized = normalizeQueryPath(query);
  const result = new Set<string>();
  if (normalized.length > 0) result.add(normalized);
  const packagesIndex = normalized.lastIndexOf('packages/');
  if (packagesIndex > 0) result.add(normalized.slice(packagesIndex));
  const slash = normalized.lastIndexOf('/');
  if (slash >= 0 && slash < normalized.length - 1) result.add(normalized.slice(slash + 1));
  return Array.from(result);
};

const nodePathHaystack = (node: ContextNode): string[] => {
  const paths = new Set<string>();
  paths.add(normalizeQueryPath(node.title));
  if (node.sourceRef) paths.add(normalizeQueryPath(node.sourceRef));
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (Array.isArray(evidence)) {
    for (const entry of evidence) {
      if (entry && typeof entry === 'object' && 'path' in entry) {
        paths.add(normalizeQueryPath(String((entry as Record<string, unknown>).path)));
      }
    }
  }
  return Array.from(paths);
};

/**
 * Path-aware seed selection for `before-edit` / `impact` / `flow` /
 * `binding` / `asset-references` task queries.
 *
 * The previous `nodes.filter(includes(query))` fallback produced
 * pathological results for deep paths like
 * `packages/server/src/metabolism/scheduler.ts`: no node title contains
 * the full string, so `matching` came back empty and `selectTaskNodes`
 * fell back to "first N global-hot nodes" (README.md, tsconfig.base.json,
 * web-ui/i18n). This selector instead:
 *
 *   1. If `query` looks like a path, find nodes whose title /
 *      sourceRef / evidence path equals one of the path candidates.
 *      Returns those as seeds. Never returns README.md for a deep path.
 *   2. Otherwise, fall back to the token-includes matcher (treating
 *      the query as natural language).
 *
 * Returning an empty array when the path is real but unindexed is
 * deliberate: the report builder downstream will then say "no graph
 * nodes match" rather than fabricate a wrong impact set.
 */
export const collectTaskQuerySeeds = (
  nodes: ContextNode[],
  query: string | undefined,
): ContextNode[] => {
  if (typeof query !== 'string' || query.length === 0) return [];
  if (looksLikeFilePath(query)) {
    const candidates = pathMatchCandidates(query);
    const matched = nodes.filter((node) => {
      const haystack = nodePathHaystack(node);
      return candidates.some((candidate) => haystack.includes(candidate));
    });
    if (matched.length > 0) return matched;
    // The query was clearly a path but nothing matched. Do not fall
    // back to substring search — README.md would match the bare leaf
    // `scheduler.ts` of any other scheduler.ts in the repo and the
    // downstream report would be wrong. Empty seeds means "we honestly
    // do not have this file in the graph", which the report builder
    // surfaces explicitly.
    return [];
  }
  const lowered = query.toLowerCase();
  return nodes.filter((node) =>
    node.title.toLowerCase().includes(lowered)
      || node.id.toLowerCase().includes(lowered),
  );
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
