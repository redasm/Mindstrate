import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export interface IngestTerminalOutputInput {
  content: string;
  project?: string;
  sessionId?: string;
  actor?: string;
  command?: string;
  exitCode?: number;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export function ingestTerminalOutput(
  graphStore: ContextGraphStore,
  input: IngestTerminalOutputInput,
): IngestContextEventResult {
  const titlePrefix = input.command ? `terminal output (${input.command})` : 'terminal output';

  return ingestContextEvent(graphStore, {
    type: ContextEventType.TERMINAL_OUTPUT,
    content: input.content,
    project: input.project,
    sessionId: input.sessionId,
    actor: input.actor ?? 'terminal',
    domainType: ContextDomainType.TROUBLESHOOTING,
    substrateType: SubstrateType.EPISODE,
    title: `${titlePrefix}: ${input.content.slice(0, 80)}`,
    tags: ['terminal-output'],
    sourceRef: input.sourceRef ?? input.command,
    metadata: {
      command: input.command,
      exitCode: input.exitCode,
      ...(input.metadata ?? {}),
    },
  });
}
