import { KnowledgeType } from '@mindstrate/protocol';
import { ContextDomainType, type ContextNode } from '@mindstrate/protocol/models';
import type { GraphKnowledgeSearchResult } from '@mindstrate/protocol';

export const computeGraphNodeMatchScore = (tokens: string[], node: ContextNode): number => {
  const haystack = `${node.title}\n${node.content}\n${node.tags.join(' ')}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;

  const lexicalScore = matched / tokens.length;
  const qualityScore = Math.min(node.qualityScore / 100, 1);
  const confidenceScore = Math.min(node.confidence, 1);
  return lexicalScore * 0.6 + qualityScore * 0.25 + confidenceScore * 0.15;
};

export const generateGraphCurationSummary = (
  task: string,
  knowledge: GraphKnowledgeSearchResult[],
  workflows: GraphKnowledgeSearchResult[],
  warnings: GraphKnowledgeSearchResult[],
): string => {
  const parts: string[] = [`Curated graph context for: ${task}`];
  if (knowledge.length > 0) {
    parts.push(`Relevant graph knowledge: ${knowledge.map((result) => result.view.title).join(', ')}`);
  }
  if (workflows.length > 0) {
    parts.push(`Applicable workflows: ${workflows.map((result) => result.view.title).join(', ')}`);
  }
  if (warnings.length > 0) {
    parts.push(`Potential pitfalls: ${warnings.map((result) => result.view.title).join(', ')}`);
  }
  if (parts.length === 1) {
    parts.push('No directly matching graph knowledge found. Use project/session substrate and proceed carefully.');
  }
  return parts.join('\n');
};

export const getGraphStats = (nodes: ContextNode[]): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byLanguage: Record<string, number>;
} => {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const node of nodes) {
    byType[node.domainType] = (byType[node.domainType] ?? 0) + 1;
    byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
    const language = getStringMetadata(node, 'context', 'language');
    if (language) {
      byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    }
  }

  return {
    total: nodes.length,
    byType,
    byStatus,
    byLanguage,
  };
};

export const getStringMetadata = (node: ContextNode, objectKey: string, valueKey: string): string => {
  const value = node.metadata?.[objectKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const nested = (value as Record<string, unknown>)[valueKey];
  return typeof nested === 'string' ? nested : '';
};

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
