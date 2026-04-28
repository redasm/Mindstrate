import type {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from './context-graph.js';

/**
 * Graph-first knowledge projection for ECS-native consumers.
 *
 * This view is explicitly derived from
 * the context graph and preserves substrate lineage in the payload.
 */
export interface GraphKnowledgeView {
  id: string;
  title: string;
  summary: string;
  /** Full node content when available. Projection consumers may use summary for compact lists. */
  content?: string;
  substrateType: SubstrateType;
  domainType: ContextDomainType;
  project?: string;
  priorityScore: number;
  status: ContextNodeStatus;
  sourceRef?: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface GraphKnowledgeSearchResult {
  view: GraphKnowledgeView;
  relevanceScore: number;
  matchReason?: string;
  /** 检索追踪 ID（用于自动反馈闭环） */
  retrievalId?: string;
}
