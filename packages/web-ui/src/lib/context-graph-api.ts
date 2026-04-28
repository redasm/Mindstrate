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
};

export type ContextGraphEdgeDto = {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
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
