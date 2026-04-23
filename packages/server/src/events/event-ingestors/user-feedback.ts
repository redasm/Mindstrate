import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { FeedbackEvent } from '@mindstrate/protocol';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export interface IngestUserFeedbackInput {
  retrievalId: string;
  signal: FeedbackEvent['signal'];
  context?: string;
  project?: string;
  sessionId?: string;
}

export function ingestUserFeedback(
  graphStore: ContextGraphStore,
  input: IngestUserFeedbackInput,
): IngestContextEventResult {
  const content = `feedback ${input.signal}: ${input.context ?? input.retrievalId}`;
  return ingestContextEvent(graphStore, {
    type: ContextEventType.FEEDBACK_SIGNAL,
    content,
    project: input.project,
    sessionId: input.sessionId,
    actor: 'feedback-loop',
    domainType: ContextDomainType.CONTEXT_EVENT,
    substrateType: SubstrateType.EPISODE,
    title: `feedback signal: ${input.signal}`,
    tags: ['feedback-signal', input.signal],
    sourceRef: input.retrievalId,
    metadata: {
      retrievalId: input.retrievalId,
      signal: input.signal,
      context: input.context,
    },
  });
}
