import type { GraphKnowledgeView } from '@mindstrate/protocol';
import {
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
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

export interface GraphKnowledgeProjectionOptions {
  project?: string;
  limit?: number;
  includeStatuses?: ContextNodeStatus[];
}

export class GraphKnowledgeProjector {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  project(options: GraphKnowledgeProjectionOptions = {}): GraphKnowledgeView[] {
    const limit = options.limit ?? 20;
    const includeStatuses = options.includeStatuses ?? [
      ContextNodeStatus.ACTIVE,
      ContextNodeStatus.VERIFIED,
      ContextNodeStatus.CONFLICTED,
      ContextNodeStatus.CANDIDATE,
    ];

    const nodes = this.graphStore.listNodes({
      project: options.project,
      limit: 500,
    }).filter((node) =>
      includeStatuses.includes(node.status) &&
      isProjectable(node.substrateType),
    );

    return nodes
      .map((node) => toGraphKnowledgeView(node))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, limit);
  }
}

function isProjectable(substrateType: SubstrateType): boolean {
  return [
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
    substrateType: node.substrateType,
    domainType: node.domainType,
    project: node.project,
    priorityScore: priorityBase + qualityBoost + confidenceBoost,
    status: node.status,
    sourceRef: node.sourceRef,
    tags: node.tags,
  };
}

function summarize(content: string): string {
  const firstParagraph = content.split('\n\n')[0] ?? content;
  return firstParagraph.trim();
}
