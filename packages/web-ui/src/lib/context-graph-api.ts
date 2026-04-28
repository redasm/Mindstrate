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

export async function fetchContextGraph(limit: number): Promise<ContextGraphNodeDto[]> {
  const response = await fetch(`/api/context-graph?limit=${limit}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.nodes ?? [];
}

export async function fetchContextEdges(limit: number): Promise<ContextGraphEdgeDto[]> {
  const response = await fetch(`/api/context-edges?limit=${limit}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.edges ?? [];
}
