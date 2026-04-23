import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { KnowledgeUnit } from '@mindstrate/protocol';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export function ingestKnowledgeWrite(
  graphStore: ContextGraphStore,
  knowledge: KnowledgeUnit,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: ContextEventType.KNOWLEDGE_WRITE,
    content: `${knowledge.title}\n${knowledge.solution}`,
    project: knowledge.context.project,
    actor: knowledge.metadata.author,
    domainType: mapKnowledgeTypeToDomainType(knowledge.type),
    substrateType: SubstrateType.EPISODE,
    title: `knowledge write: ${knowledge.title}`,
    tags: ['knowledge-write', ...knowledge.tags],
    sourceRef: knowledge.id,
    metadata: {
      knowledgeId: knowledge.id,
      knowledgeType: knowledge.type,
    },
  });
}

function mapKnowledgeTypeToDomainType(type: KnowledgeUnit['type']): ContextDomainType {
  return type as unknown as ContextDomainType;
}
