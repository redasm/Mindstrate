import { KnowledgeType, type CreateKnowledgeInput } from '@mindstrate/protocol';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { CreateContextNodeInput } from './context-graph-store.js';

export interface DigestedKnowledgeNode {
  nodeInput: CreateContextNodeInput;
}

export function digestKnowledgeInput(
  input: CreateKnowledgeInput,
  options: {
    completenessScore: number;
  },
): DigestedKnowledgeNode {
  return {
    nodeInput: {
      substrateType: mapKnowledgeTypeToSubstrate(input.type),
      domainType: mapKnowledgeTypeToDomain(input.type),
      title: input.title.trim(),
      content: input.solution.trim(),
      tags: input.tags ?? [],
      project: input.context?.project,
      compressionLevel: mapKnowledgeTypeToCompression(input.type),
      confidence: input.confidence ?? 0.5,
      qualityScore: options.completenessScore,
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        knowledgeType: input.type,
        problem: input.problem,
        codeSnippets: input.codeSnippets,
        actionable: input.actionable,
        context: input.context,
        author: input.author,
        source: input.source,
        commitHash: input.commitHash,
        confidence: input.confidence ?? 0.5,
      },
    },
  };
}

export function nodeToKnowledgeType(node: ContextNode): CreateKnowledgeInput['type'] {
  const explicit = node.metadata?.['knowledgeType'];
  if (typeof explicit === 'string') {
    return explicit as CreateKnowledgeInput['type'];
  }

  switch (node.domainType) {
    case ContextDomainType.ARCHITECTURE:
      return KnowledgeType.ARCHITECTURE;
    case ContextDomainType.CONVENTION:
      return KnowledgeType.CONVENTION;
    case ContextDomainType.PATTERN:
      return KnowledgeType.PATTERN;
    case ContextDomainType.WORKFLOW:
      return KnowledgeType.WORKFLOW;
    case ContextDomainType.BUG_FIX:
      return KnowledgeType.BUG_FIX;
    case ContextDomainType.TROUBLESHOOTING:
      return KnowledgeType.TROUBLESHOOTING;
    case ContextDomainType.GOTCHA:
      return KnowledgeType.GOTCHA;
    case ContextDomainType.HOW_TO:
      return KnowledgeType.HOW_TO;
    default:
      return KnowledgeType.BEST_PRACTICE;
  }
}

function mapKnowledgeTypeToSubstrate(type: CreateKnowledgeInput['type']): SubstrateType {
  switch (type) {
    case 'architecture':
    case 'convention':
    case 'workflow':
      return SubstrateType.RULE;
    case 'pattern':
      return SubstrateType.PATTERN;
    default:
      return SubstrateType.SUMMARY;
  }
}

function mapKnowledgeTypeToDomain(type: CreateKnowledgeInput['type']): ContextDomainType {
  switch (type) {
    case 'bug_fix':
      return ContextDomainType.BUG_FIX;
    case 'best_practice':
      return ContextDomainType.BEST_PRACTICE;
    case 'architecture':
      return ContextDomainType.ARCHITECTURE;
    case 'convention':
      return ContextDomainType.CONVENTION;
    case 'pattern':
      return ContextDomainType.PATTERN;
    case 'troubleshooting':
      return ContextDomainType.TROUBLESHOOTING;
    case 'gotcha':
      return ContextDomainType.GOTCHA;
    case 'how_to':
      return ContextDomainType.HOW_TO;
    case 'workflow':
      return ContextDomainType.WORKFLOW;
    default:
      return ContextDomainType.BEST_PRACTICE;
  }
}

function mapKnowledgeTypeToCompression(type: CreateKnowledgeInput['type']): number {
  switch (type) {
    case 'architecture':
    case 'convention':
    case 'workflow':
      return 0.02;
    case 'pattern':
      return 0.04;
    default:
      return 0.08;
  }
}
