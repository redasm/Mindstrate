import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export interface IngestLspDiagnosticInput {
  content: string;
  project?: string;
  sessionId?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export function ingestLspDiagnostic(
  graphStore: ContextGraphStore,
  input: IngestLspDiagnosticInput,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: ContextEventType.LSP_DIAGNOSTIC,
    content: input.content,
    project: input.project,
    sessionId: input.sessionId,
    actor: 'lsp',
    domainType: ContextDomainType.TROUBLESHOOTING,
    substrateType: SubstrateType.EPISODE,
    title: `lsp diagnostic: ${input.content.slice(0, 80)}`,
    tags: ['lsp-diagnostic'],
    sourceRef: input.sourceRef,
    metadata: input.metadata,
  });
}
