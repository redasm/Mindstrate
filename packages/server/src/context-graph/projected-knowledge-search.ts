import type { GraphKnowledgeSearchResult, GraphKnowledgeView } from '@mindstrate/protocol/models';
import type { GraphKnowledgeProjector, GraphKnowledgeProjectionOptions } from './knowledge-projector.js';

export interface ProjectedKnowledgeSearchOptions extends GraphKnowledgeProjectionOptions {
  topK?: number;
}

export class ProjectedKnowledgeSearch {
  private readonly projector: GraphKnowledgeProjector;

  constructor(projector: GraphKnowledgeProjector) {
    this.projector = projector;
  }

  search(query: string, options: ProjectedKnowledgeSearchOptions = {}): GraphKnowledgeSearchResult[] {
    const candidates = this.projector.project({
      project: options.project,
      limit: options.limit ?? 50,
      includeStatuses: options.includeStatuses,
    });

    return candidates
      .map((view) => ({
        view,
        relevanceScore: computeProjectionMatchScore(query, view),
        matchReason: `Projected ${view.substrateType} match`,
      }))
      .filter((result) => result.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, options.topK ?? 10);
  }
}

function computeProjectionMatchScore(query: string, view: GraphKnowledgeView): number {
  const haystack = `${view.title}\n${view.summary}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;

  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;

  const lexicalScore = matched / tokens.length;
  return Math.min(0.99, lexicalScore * 0.6 + Math.min(view.priorityScore, 1) * 0.4);
}
