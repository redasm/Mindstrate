import type {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from './context-graph.js';

/**
 * Graph-first knowledge projection for ECS-native consumers.
 *
 * Unlike the legacy KnowledgeUnit shape, this view is explicitly derived from
 * the context graph and preserves substrate lineage in the payload.
 */
export interface GraphKnowledgeView {
  id: string;
  title: string;
  summary: string;
  substrateType: SubstrateType;
  domainType: ContextDomainType;
  project?: string;
  priorityScore: number;
  status: ContextNodeStatus;
  sourceRef?: string;
  tags: string[];
}

export interface GraphKnowledgeSearchResult {
  view: GraphKnowledgeView;
  relevanceScore: number;
  matchReason?: string;
}
