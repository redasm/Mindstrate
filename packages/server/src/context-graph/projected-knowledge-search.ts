import type { GraphKnowledgeSearchResult, GraphKnowledgeView } from '@mindstrate/protocol/models';
import {
  ContextRelationType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';
import type { GraphKnowledgeProjector, GraphKnowledgeProjectionOptions } from './knowledge-projector.js';

export interface ProjectedKnowledgeSearchOptions extends GraphKnowledgeProjectionOptions {
  topK?: number;
  sessionId?: string;
  trackFeedback?: boolean;
}

export class ProjectedKnowledgeSearch {
  private readonly projector: GraphKnowledgeProjector;
  private readonly graphStore?: ContextGraphStore;

  constructor(projector: GraphKnowledgeProjector, graphStore?: ContextGraphStore) {
    this.projector = projector;
    this.graphStore = graphStore;
  }

  search(query: string, options: ProjectedKnowledgeSearchOptions = {}): GraphKnowledgeSearchResult[] {
    const candidates = this.projector.project({
      project: options.project,
      limit: options.limit ?? 50,
      includeStatuses: options.includeStatuses,
    });

    return candidates
      .map((view) => this.scoreView(query, view))
      .filter((result) => result.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, options.topK ?? 10);
  }

  private scoreView(query: string, view: GraphKnowledgeView): GraphKnowledgeSearchResult {
    const directScore = computeProjectionMatchScore(query, view);
    const related = this.findBestSupportingEvidence(query, view);
    if (related && related.score > directScore) {
      return {
        view,
        relevanceScore: Math.min(0.99, related.score * 0.75 + Math.min(view.priorityScore, 1) * 0.25),
        matchReason: `Graph projection | Projected ${view.substrateType} match supported by related ${related.node.substrateType}`,
      };
    }

    return {
      view,
      relevanceScore: directScore,
      matchReason: `Graph projection | Projected ${view.substrateType} match`,
    };
  }

  private findBestSupportingEvidence(
    query: string,
    view: GraphKnowledgeView,
  ): { node: ContextNode; score: number } | null {
    if (!this.graphStore) return null;

    const supportEdges = this.graphStore.listIncomingEdges(view.id, ContextRelationType.SUPPORTS);
    let best: { node: ContextNode; score: number } | null = null;
    for (const edge of supportEdges) {
      const node = this.graphStore.getNodeById(edge.sourceId);
      if (!node) continue;
      const score = computeTextMatchScore(query, `${node.title}\n${node.content}`);
      if (!best || score > best.score) {
        best = { node, score };
      }
    }
    return best;
  }
}

function computeProjectionMatchScore(query: string, view: GraphKnowledgeView): number {
  const haystack = `${view.title}\n${view.summary}`.toLowerCase();
  const lexicalScore = computeTextMatchScore(query, haystack);
  if (lexicalScore === 0) return 0;

  return Math.min(0.99, lexicalScore * 0.6 + Math.min(view.priorityScore, 1) * 0.4);
}

function computeTextMatchScore(query: string, haystack: string): number {
  const normalizedHaystack = haystack.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;

  const matched = tokens.filter((token) => normalizedHaystack.includes(token)).length;
  if (matched === 0) return 0;

  return matched / tokens.length;
}
