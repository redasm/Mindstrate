import type { ContextEvent, ContextNode } from '@mindstrate/protocol/models';
import {
  ingestContextEvent,
  ingestGitActivity,
  ingestLspDiagnostic,
  ingestTerminalOutput,
  ingestTestRun,
  type IngestContextEventInput,
} from '../events/index.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateEventApi {
  constructor(private readonly services: MindstrateRuntime) {}

  ingestEvent(input: IngestContextEventInput): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestContextEvent(this.services.contextGraphStore, input);
  }

  ingestGitActivity(input: {
    content: string;
    project?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestGitActivity(this.services.contextGraphStore, input);
  }

  ingestTestRun(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestTestRun(this.services.contextGraphStore, input);
  }

  ingestLspDiagnostic(input: {
    content: string;
    project?: string;
    sessionId?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestLspDiagnostic(this.services.contextGraphStore, input);
  }

  ingestTerminalOutput(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    command?: string;
    exitCode?: number;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestTerminalOutput(this.services.contextGraphStore, input);
  }
}

