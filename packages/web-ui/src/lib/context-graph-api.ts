export type ContextGraphNodeDto = {
  id: string;
  substrateType: string;
  domainType: string;
  title: string;
  content: string;
  tags: string[];
  project?: string;
  status: string;
  qualityScore: number;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
};

export type ContextGraphEdgeDto = {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
  evidence?: Record<string, unknown>;
};

export type ProjectSubgraph = {
  nodes: ContextGraphNodeDto[];
  edges: ContextGraphEdgeDto[];
};

export const SUBSTRATE_ORDER = ['axiom', 'heuristic', 'rule', 'skill', 'pattern', 'summary', 'snapshot', 'episode'];

async function fetchGraphResource<T>(path: string, key: string): Promise<T[]> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Graph API request failed: ${response.status}`);
  }

  const data = await response.json();
  return data[key] ?? [];
}

export async function fetchContextGraph(limit: number): Promise<ContextGraphNodeDto[]> {
  return fetchGraphResource<ContextGraphNodeDto>(`/api/context-graph?limit=${limit}`, 'nodes');
}

export async function fetchContextEdges(limit: number): Promise<ContextGraphEdgeDto[]> {
  return fetchGraphResource<ContextGraphEdgeDto>(`/api/context-edges?limit=${limit}`, 'edges');
}

/**
 * Bounded project-graph subgraph: the skeleton (directory/file) when no focus,
 * or the one-hop neighborhood around `focus`. Backed by
 * GET /api/context-graph/subgraph.
 */
export async function fetchProjectSubgraph(
  project: string,
  opts: { focus?: string; kinds?: string[]; limit?: number } = {},
): Promise<ProjectSubgraph> {
  const params = new URLSearchParams({ project });
  if (opts.focus) params.set('focus', opts.focus);
  if (opts.kinds && opts.kinds.length > 0) params.set('kinds', opts.kinds.join(','));
  params.set('limit', String(opts.limit ?? 300));

  const response = await fetch(`/api/context-graph/subgraph?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Subgraph API request failed: ${response.status}`);
  }
  const data = await response.json();
  return { nodes: data.nodes ?? [], edges: data.edges ?? [] };
}
