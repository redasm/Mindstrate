/**
 * MCP Server Shared Types
 */

import type {
  ConflictRecord,
  CreateKnowledgeInput,
  ContextDomainType,
  ContextEdge,
  ContextEvent,
  ContextEventType,
  ContextNode,
  ContextNodeStatus,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  MetabolismRun,
  RetrievalFilter,
  RetrievalResult,
  RetrievalContext,
  KnowledgeUnit,
  CuratedContext,
  AssembledContext,
  Session,
  EvolutionRunResult,
  PipelineResult,
  PortableContextBundle,
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
  saveObservation(input: { sessionId: string; type: string; content: string; metadata?: Record<string, string> }): void;
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
  readGraphKnowledge(opts?: { project?: string; limit?: number }): GraphKnowledgeView[];
  queryGraphKnowledge(query: string, opts?: { project?: string; topK?: number; limit?: number }): GraphKnowledgeSearchResult[];
  ingestEvent(input: {
    type: ContextEventType;
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    domainType?: ContextDomainType;
    substrateType?: string;
    title?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string };
  queryContextGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: string;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): ContextNode[];
  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: string;
    limit?: number;
  }): ContextEdge[];
  listConflictRecords(project?: string, limit?: number): ConflictRecord[];
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  createBundle(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): PortableContextBundle;
  validateBundle(bundle: PortableContextBundle): { valid: boolean; errors: string[] };
  installBundle(bundle: PortableContextBundle): {
    installedNodes: number;
    updatedNodes: number;
    installedEdges: number;
    skippedEdges: number;
  };
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
  saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>): Promise<void>;
  endSession(sessionId: string, summary?: string, openTasks?: string[]): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  getActiveSession(project: string): Promise<Session | null>;
  formatSessionContext(project: string): Promise<string | null>;
  getStats(): Promise<unknown>;
  recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string): Promise<void>;
  curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext>;
  assembleContext(task: string, options?: { project?: string; context?: RetrievalContext; sessionId?: string }): Promise<AssembledContext>;
  runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult>;
  readGraphKnowledge(opts?: { project?: string; limit?: number }): Promise<GraphKnowledgeView[]>;
  queryGraphKnowledge(query: string, opts?: { project?: string; topK?: number; limit?: number }): Promise<GraphKnowledgeSearchResult[]>;
  ingestContextEvent(input: {
    type: ContextEventType;
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    domainType?: ContextDomainType;
    substrateType?: string;
    title?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<{ eventId: string; nodeId: string }>;
  queryContextGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: string;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): Promise<ContextNode[]>;
  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: string;
    limit?: number;
  }): Promise<ContextEdge[]>;
  listContextConflicts(options?: { project?: string; limit?: number }): Promise<ConflictRecord[]>;
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  createBundle(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): Promise<PortableContextBundle>;
  validateBundle(bundle: PortableContextBundle): Promise<{ valid: boolean; errors: string[] }>;
  installBundle(bundle: PortableContextBundle): Promise<{
    installedNodes: number;
    updatedNodes: number;
    installedEdges: number;
    skippedEdges: number;
  }>;
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
