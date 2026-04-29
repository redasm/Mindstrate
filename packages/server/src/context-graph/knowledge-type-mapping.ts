import { KnowledgeType } from '@mindstrate/protocol';
import { ContextDomainType } from '@mindstrate/protocol/models';

/**
 * Map a public KnowledgeType (used in CreateKnowledgeInput) to its
 * corresponding ContextDomainType (used inside the ECS context graph).
 * Falls back to BEST_PRACTICE for unknown values.
 */
export const knowledgeTypeToContextDomain = (type: string): ContextDomainType => {
  switch (type) {
    case KnowledgeType.BUG_FIX:
      return ContextDomainType.BUG_FIX;
    case KnowledgeType.BEST_PRACTICE:
      return ContextDomainType.BEST_PRACTICE;
    case KnowledgeType.ARCHITECTURE:
      return ContextDomainType.ARCHITECTURE;
    case KnowledgeType.CONVENTION:
      return ContextDomainType.CONVENTION;
    case KnowledgeType.PATTERN:
      return ContextDomainType.PATTERN;
    case KnowledgeType.TROUBLESHOOTING:
      return ContextDomainType.TROUBLESHOOTING;
    case KnowledgeType.GOTCHA:
      return ContextDomainType.GOTCHA;
    case KnowledgeType.HOW_TO:
      return ContextDomainType.HOW_TO;
    case KnowledgeType.WORKFLOW:
      return ContextDomainType.WORKFLOW;
    default:
      return ContextDomainType.BEST_PRACTICE;
  }
};
