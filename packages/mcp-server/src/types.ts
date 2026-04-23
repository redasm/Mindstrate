/**
 * MCP Server Shared Types
 */

import type {
  CreateKnowledgeInput,
  RetrievalFilter,
  RetrievalResult,
  RetrievalContext,
  KnowledgeUnit,
  CuratedContext,
  AssembledContext,
  Session,
  EvolutionRunResult,
  PipelineResult,
} from '@mindstrate/protocol';

/**
 * Minimal interface the MCP server needs from a local Mindstrate instance.
 * The concrete class lives in @mindstrate/server (loaded lazily so the
 * default team-only distribution can stay free of native deps).
 */
export interface LocalMemory {
  init(): Promise<void>;
  search(query: string, opts?: { topK?: number; filter?: RetrievalFilter }): Promise<RetrievalResult[]>;
  add(input: CreateKnowledgeInput): Promise<PipelineResult>;
  get(id: string): KnowledgeUnit | null;
  upvote(id: string): void;
  downvote(id: string): void;
  startSession(input: { project?: string; techContext?: string }): Promise<Session>;
  saveObservation(input: { sessionId: string; type: string; content: string }): void;
  compressSession(input: { sessionId: string; summary: string; openTasks?: string[] }): void;
  endSession(sessionId: string): Promise<void>;
  getSession(id: string): Session | null;
  getActiveSession(project: string): Session | null;
  formatSessionContext(project: string): string;
  getStats(): Promise<unknown>;
  recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string): void;
  curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext>;
  assembleContext(task: string, options?: { project?: string; context?: RetrievalContext; sessionId?: string }): Promise<AssembledContext>;
  runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult>;
  addMutationSink(sink: unknown): void;
  close(): void;
}

/** Unified API interface that abstracts local/team mode differences */
export interface McpApi {
  init(): Promise<void>;
  search(query: string, opts?: { topK?: number; filter?: RetrievalFilter }): Promise<RetrievalResult[]>;
  add(input: CreateKnowledgeInput): Promise<PipelineResult>;
  get(id: string): Promise<KnowledgeUnit | null>;
  upvote(id: string): Promise<void>;
  downvote(id: string): Promise<void>;
  startSession(project: string, techContext?: string): Promise<{ session: Session; context: string | null }>;
  saveObservation(sessionId: string, type: string, content: string): Promise<void>;
  endSession(sessionId: string, summary?: string, openTasks?: string[]): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  getActiveSession(project: string): Promise<Session | null>;
  formatSessionContext(project: string): Promise<string | null>;
  getStats(): Promise<unknown>;
  recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string): Promise<void>;
  curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext>;
  assembleContext(task: string, options?: { project?: string; context?: RetrievalContext; sessionId?: string }): Promise<AssembledContext>;
  runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult>;
  close(): void;
}

/** Mutable session state tracked by the MCP server */
export interface SessionState {
  currentSessionId: string | null;
  currentSessionProject: string;
}

/** Standard MCP tool response shape */
export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}
