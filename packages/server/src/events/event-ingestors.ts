import type { FeedbackEvent } from '@mindstrate/protocol';
import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from './context-event.js';

interface EventIngestInput {
  content: string;
  project?: string;
  sessionId?: string;
  actor?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestGitActivityInput extends EventIngestInput {}

export interface IngestTestRunInput extends EventIngestInput {}

export interface IngestLspDiagnosticInput {
  content: string;
  project?: string;
  sessionId?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestTerminalOutputInput extends EventIngestInput {
  command?: string;
  exitCode?: number;
}

export interface IngestUserFeedbackInput {
  retrievalId: string;
  signal: FeedbackEvent['signal'];
  context?: string;
  project?: string;
  sessionId?: string;
}

interface EventIngestSpec {
  type: ContextEventType;
  titlePrefix: string;
  tag: string;
  actor: string;
  domainType: ContextDomainType;
}

export function ingestGitActivity(
  graphStore: ContextGraphStore,
  input: IngestGitActivityInput,
): IngestContextEventResult {
  return ingestTypedEvent(graphStore, input, {
    type: ContextEventType.GIT_ACTIVITY,
    titlePrefix: 'git activity',
    tag: 'git-activity',
    actor: 'git',
    domainType: ContextDomainType.ARCHITECTURE,
  });
}

export function ingestTestRun(
  graphStore: ContextGraphStore,
  input: IngestTestRunInput,
): IngestContextEventResult {
  return ingestTypedEvent(graphStore, input, {
    type: ContextEventType.TEST_RESULT,
    titlePrefix: 'test result',
    tag: 'test-result',
    actor: 'test-runner',
    domainType: ContextDomainType.TROUBLESHOOTING,
  });
}

export function ingestLspDiagnostic(
  graphStore: ContextGraphStore,
  input: IngestLspDiagnosticInput,
): IngestContextEventResult {
  return ingestTypedEvent(graphStore, {
    ...input,
    actor: 'lsp',
  }, {
    type: ContextEventType.LSP_DIAGNOSTIC,
    titlePrefix: 'lsp diagnostic',
    tag: 'lsp-diagnostic',
    actor: 'lsp',
    domainType: ContextDomainType.TROUBLESHOOTING,
  });
}

export function ingestTerminalOutput(
  graphStore: ContextGraphStore,
  input: IngestTerminalOutputInput,
): IngestContextEventResult {
  const titlePrefix = input.command ? `terminal output (${input.command})` : 'terminal output';

  return ingestTypedEvent(graphStore, {
    ...input,
    sourceRef: input.sourceRef ?? input.command,
    metadata: {
      command: input.command,
      exitCode: input.exitCode,
      ...(input.metadata ?? {}),
    },
  }, {
    type: ContextEventType.TERMINAL_OUTPUT,
    titlePrefix,
    tag: 'terminal-output',
    actor: 'terminal',
    domainType: ContextDomainType.TROUBLESHOOTING,
  });
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

function ingestTypedEvent(
  graphStore: ContextGraphStore,
  input: EventIngestInput,
  spec: EventIngestSpec,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: spec.type,
    content: input.content,
    project: input.project,
    sessionId: input.sessionId,
    actor: input.actor ?? spec.actor,
    domainType: spec.domainType,
    substrateType: SubstrateType.EPISODE,
    title: `${spec.titlePrefix}: ${input.content.slice(0, 80)}`,
    tags: [spec.tag],
    sourceRef: input.sourceRef,
    metadata: input.metadata,
  });
}
