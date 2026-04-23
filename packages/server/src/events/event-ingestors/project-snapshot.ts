import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { KnowledgeUnit } from '@mindstrate/protocol';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export function ingestProjectSnapshotEvent(
  graphStore: ContextGraphStore,
  knowledge: KnowledgeUnit,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: ContextEventType.PROJECT_SNAPSHOT,
    content: knowledge.solution,
    project: knowledge.context.project,
    actor: knowledge.metadata.author,
    domainType: ContextDomainType.PROJECT_SNAPSHOT,
    substrateType: SubstrateType.SNAPSHOT,
    title: `project snapshot: ${knowledge.title}`,
    tags: ['project-snapshot', ...knowledge.tags],
    sourceRef: knowledge.id,
    metadata: {
      knowledgeId: knowledge.id,
    },
  });
}
