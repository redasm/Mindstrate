import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export interface IngestTestRunInput {
  content: string;
  project?: string;
  sessionId?: string;
  actor?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export function ingestTestRun(
  graphStore: ContextGraphStore,
  input: IngestTestRunInput,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: ContextEventType.TEST_RESULT,
    content: input.content,
    project: input.project,
    sessionId: input.sessionId,
    actor: input.actor ?? 'test-runner',
    domainType: ContextDomainType.TROUBLESHOOTING,
    substrateType: SubstrateType.EPISODE,
    title: `test result: ${input.content.slice(0, 80)}`,
    tags: ['test-result'],
    sourceRef: input.sourceRef,
    metadata: input.metadata,
  });
}
