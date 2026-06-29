import type { GraphKnowledgeView } from '@mindstrate/protocol';
import {
  ContextNodeStatus,
  LLM_ENRICHMENT_CACHE_TAG,
  SubstrateType,
  type ContextNode,
  isProjectGraphNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';

const SUBSTRATE_PRIORITY: Record<SubstrateType, number> = {
  [SubstrateType.AXIOM]: 1.0,
  [SubstrateType.HEURISTIC]: 0.95,
  [SubstrateType.RULE]: 0.9,
  [SubstrateType.SKILL]: 0.82,
  [SubstrateType.PATTERN]: 0.72,
  [SubstrateType.SUMMARY]: 0.62,
  [SubstrateType.SNAPSHOT]: 0.45,
  [SubstrateType.EPISODE]: 0.3,
};

/**
 * SQL prefetch when the caller requests ALL knowledge (limit undefined). The
 * knowledge layer (hand-authored + metabolized nodes) is small and bounded —
 * project-graph nodes are excluded in SQL — so this only needs to comfortably
 * exceed any realistic knowledge-node count, not the 100k+ scanner graph.
 */
const ALL_KNOWLEDGE_PREFETCH = 100000;

export interface GraphKnowledgeProjectionOptions {
  project?: string;
  limit?: number;
  includeStatuses?: ContextNodeStatus[];
  includeProjectGraphNodes?: boolean;
}

export class GraphKnowledgeProjector {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  project(options: GraphKnowledgeProjectionOptions = {}): GraphKnowledgeView[] {
    // `limit` undefined means "return all" — used by the knowledge-list path,
    // which excludes project-graph nodes, so the result is bounded by the
    // (small) knowledge-node count rather than the 100k+ scanner graph. A
    // provided limit (always the case for search) keeps a bounded prefetch.
    const limit = options.limit;
    const includeStatuses = options.includeStatuses ?? [
      ContextNodeStatus.ACTIVE,
      ContextNodeStatus.VERIFIED,
      ContextNodeStatus.CANDIDATE,
    ];
    const excludeProjectGraph = options.includeProjectGraphNodes !== true;

    // Push the project-graph exclusion into SQL when the caller doesn't want
    // those nodes. Without it, a project with a large scanner graph (100k+
    // file/symbol nodes) fills the prefetch window with graph rows ordered by
    // updated_at, and the post-filter leaves zero knowledge nodes — the
    // knowledge page goes blank right after a re-scan even though the
    // knowledge is intact. When graph nodes ARE wanted, keep a generous
    // prefetch so the priority sort still has a wide candidate set.
    const prefetch = limit === undefined
      ? ALL_KNOWLEDGE_PREFETCH
      : (excludeProjectGraph ? Math.max(limit * 10, 500) : 2000);
    const nodes = this.graphStore.listNodes({
      project: options.project,
      excludeProjectGraph,
      limit: prefetch,
    }).filter((node) =>
      includeStatuses.includes(node.status) &&
      isProjectable(node.substrateType) &&
      !node.tags.includes(LLM_ENRICHMENT_CACHE_TAG) &&
      (options.includeProjectGraphNodes === true || !isProjectGraphNode(node)),
    );

    const ranked = nodes
      .map((node) => toGraphKnowledgeView(node))
      .sort((a, b) => b.priorityScore - a.priorityScore);
    return limit === undefined ? ranked : ranked.slice(0, limit);
  }
}

export function isProjectable(substrateType: SubstrateType): boolean {
  return [
    SubstrateType.SNAPSHOT,
    SubstrateType.SUMMARY,
    SubstrateType.PATTERN,
    SubstrateType.SKILL,
    SubstrateType.RULE,
    SubstrateType.HEURISTIC,
    SubstrateType.AXIOM,
  ].includes(substrateType);
}

export function toGraphKnowledgeView(node: ContextNode): GraphKnowledgeView {
  const priorityBase = SUBSTRATE_PRIORITY[node.substrateType];
  const qualityBoost = Math.min(node.qualityScore / 100, 0.1);
  const confidenceBoost = Math.min(node.confidence / 10, 0.1);

  return {
    id: node.id,
    title: node.title,
    summary: summarize(node.content),
    content: node.content,
    substrateType: node.substrateType,
    domainType: node.domainType,
    project: node.project,
    priorityScore: priorityBase + qualityBoost + confidenceBoost,
    status: node.status,
    sourceRef: node.sourceRef,
    tags: node.tags,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

function summarize(content: string): string {
  const firstParagraph = content.split('\n\n')[0] ?? content;
  return firstParagraph.trim();
}
