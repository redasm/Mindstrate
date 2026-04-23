import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
  type ContextEvent,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface IngestContextEventInput {
  type: ContextEventType;
  content: string;
  project?: string;
  sessionId?: string;
  actor?: string;
  domainType?: ContextDomainType;
  substrateType?: SubstrateType;
  title?: string;
  tags?: string[];
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  qualityScore?: number;
  status?: ContextNodeStatus;
}

export interface IngestContextEventResult {
  event: ContextEvent;
  node: ContextNode;
  previousNodeId?: string;
}

export function ingestContextEvent(
  graphStore: ContextGraphStore,
  input: IngestContextEventInput,
): IngestContextEventResult {
  const event = graphStore.createEvent({
    type: input.type,
    project: input.project,
    sessionId: input.sessionId,
    actor: input.actor ?? 'system',
    content: input.content,
    metadata: input.metadata,
  });

  const sourceRef = input.sourceRef ?? input.sessionId ?? `${input.type}:${input.project ?? 'global'}`;
  const substrateType = input.substrateType ?? SubstrateType.EPISODE;
  const previousNode = graphStore.listNodes({
    project: input.project,
    sourceRef,
    substrateType,
    limit: 5,
  }).find((node) => node.metadata?.['eventId'] !== event.id);

  const node = graphStore.createNode({
    substrateType,
    domainType: input.domainType ?? defaultDomainTypeForEvent(input.type),
    title: input.title ?? buildEventNodeTitle(input.type, input.content),
    content: input.content,
    tags: input.tags ?? ['context-event', input.type],
    project: input.project,
    compressionLevel: 1,
    confidence: input.confidence ?? 0.7,
    qualityScore: input.qualityScore ?? 50,
    status: input.status ?? ContextNodeStatus.CANDIDATE,
    sourceRef,
    metadata: {
      eventId: event.id,
      eventType: input.type,
      ...(input.metadata ?? {}),
    },
  });

  graphStore.createEdge({
    sourceId: node.id,
    targetId: node.id,
    relationType: ContextRelationType.OBSERVED_IN,
    strength: 1,
    evidence: {
      eventId: event.id,
      sessionId: input.sessionId,
    },
  });

  if (previousNode) {
    graphStore.createEdge({
      sourceId: previousNode.id,
      targetId: node.id,
      relationType: ContextRelationType.FOLLOWS,
      strength: 0.8,
      evidence: {
        eventId: event.id,
      },
    });
  }

  return {
    event,
    node,
    previousNodeId: previousNode?.id,
  };
}

function buildEventNodeTitle(type: ContextEventType, content: string): string {
  return `${type.replace(/_/g, ' ')}: ${content.slice(0, 80)}`;
}

function defaultDomainTypeForEvent(type: ContextEventType): ContextDomainType {
  switch (type) {
    case ContextEventType.GIT_ACTIVITY:
      return ContextDomainType.ARCHITECTURE;
    case ContextEventType.TEST_RESULT:
    case ContextEventType.LSP_DIAGNOSTIC:
      return ContextDomainType.TROUBLESHOOTING;
    case ContextEventType.USER_EDIT:
      return ContextDomainType.BEST_PRACTICE;
    default:
      return ContextDomainType.CONTEXT_EVENT;
  }
}
