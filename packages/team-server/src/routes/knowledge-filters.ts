import type { GraphKnowledgeView } from '@mindstrate/server';

export interface KnowledgeFilters {
  types: string[];
  tags: string[];
  status: string[];
  minScore?: number;
}

export const includesAll = (actual: string[], expected: string[]): boolean => {
  if (expected.length === 0) return true;
  return expected.every((item) => actual.includes(item));
};

export const filterGraphKnowledgeViews = (
  entries: GraphKnowledgeView[],
  filters: KnowledgeFilters,
): GraphKnowledgeView[] => entries.filter((entry) => {
  if (filters.types.length > 0 && !filters.types.includes(entry.domainType)) return false;
  if (!includesAll(entry.tags ?? [], filters.tags)) return false;
  if (filters.status.length > 0 && !filters.status.includes(entry.status)) return false;
  if (filters.minScore !== undefined && entry.priorityScore < filters.minScore) return false;
  return true;
});
