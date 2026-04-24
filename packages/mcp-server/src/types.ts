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
  RetrievalContext,
  CuratedContext,
  AssembledContext,
  Session,
  EvolutionRunResult,
  PipelineResult,
  PortableContextBundle,
} from '@mindstrate/protocol';

export interface PublishBundleOptions {
  registry?: string;
  visibility?: 'public' | 'private' | 'unlisted';
}

export interface PublishBundleResult {
  bundle: PortableContextBundle;
  manifest: {
    id: string;
    name: string;
    version: string;
    registry: string;
    visibility: 'public' | 'private' | 'unlisted';
    nodeCount: number;
    edgeCount: number;
    digest: string;
    publishedAt: string;
  };
}

export interface InstallBundleResult {
  installedNodes: number;
  updatedNodes: number;
  installedEdges: number;
  skippedEdges: number;
}

export interface InstallBundleFromRegistryOptions {
  registry: string;
  reference: string;
}

export interface InternalizationSuggestions {
  agentsMd: string;
  projectSnapshotFragment: string;
  systemPromptFragment: string;
  sourceNodeIds: string[];
}

/**
 * Minimal interface the MCP server needs from a local Mindstrate instance.
 * The concrete class lives in @mindstrate/server (loaded lazily so the
 * default team-only distribution can stay free of native deps).
 */
export interface LocalMemory {
  init(): Promise<void>;
  add(input: CreateKnowledgeInput): Promise<PipelineResult>;
  readGraphKnowledge(options?: { project?: string; limit?: number }): GraphKnowledgeView[];
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
  acceptConflictCandidate(input: { conflictId: string; candidateNodeId: string; resolution: string }): { resolved: ConflictRecord | null };
  rejectConflictCandidate(input: { conflictId: string; candidateNodeId: string; reason: string }): { rejectedNode: unknown };
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  runDigest(options?: { project?: string }): unknown;
  runAssimilation(options?: { project?: string }): unknown;
  runCompression(options?: { project?: string }): Promise<unknown>;
  runPruning(options?: { project?: string }): unknown;
  runReflection(options?: { project?: string }): unknown;
  createBundle(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): PortableContextBundle;
  validateBundle(bundle: PortableContextBundle): { valid: boolean; errors: string[] };
  installBundle(bundle: PortableContextBundle): InstallBundleResult;
  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult>;
  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): PublishBundleResult;
  generateInternalizationSuggestions(options?: { project?: string; limit?: number }): InternalizationSuggestions;
  writeObsidianProjectionFiles(options: { rootDir: string; project?: string; limit?: number }): string[];
  importObsidianProjectionFile(filePath: string): { sourceNodeId?: string; candidateNode?: unknown; event?: unknown; changed: boolean };
  close(): void;
}

/** Unified API interface that abstracts local/team mode differences */
export interface McpApi {
  init(): Promise<void>;
  add(input: CreateKnowledgeInput): Promise<PipelineResult>;
  get(id: string): Promise<GraphKnowledgeView | null>;
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
  acceptConflictCandidate(input: { conflictId: string; candidateNodeId: string; resolution: string }): Promise<{ resolved: ConflictRecord | null }>;
  rejectConflictCandidate(input: { conflictId: string; candidateNodeId: string; reason: string }): Promise<{ rejected: boolean } | { rejectedNode: unknown }>;
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  runMetabolismStage(stage: 'digest' | 'assimilate' | 'compress' | 'prune' | 'reflect', options?: { project?: string }): Promise<unknown>;
  createBundle(options: {
    name: string;
    version?: string;
    description?: string;
    project?: string;
    nodeIds?: string[];
    includeRelatedEdges?: boolean;
  }): Promise<PortableContextBundle>;
  validateBundle(bundle: PortableContextBundle): Promise<{ valid: boolean; errors: string[] }>;
  installBundle(bundle: PortableContextBundle): Promise<InstallBundleResult>;
  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult>;
  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): Promise<PublishBundleResult>;
  generateInternalizationSuggestions(options?: { project?: string; limit?: number }): Promise<InternalizationSuggestions>;
  writeObsidianProjectionFiles(options: { rootDir: string; project?: string; limit?: number }): Promise<{ files: string[] }>;
  importObsidianProjectionFile(filePath: string): Promise<{ sourceNodeId?: string; candidateNode?: unknown; event?: unknown; changed: boolean }>;
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
