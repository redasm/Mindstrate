/**
 * MCP Server Shared Types
 *
 * The `LocalMemory` interface and its `Local*SubApi` shapes intentionally
 * mirror @mindstrate/server's Mindstrate facade structurally, without
 * importing it. A static `import type { Mindstrate } from '@mindstrate/server'`
 * would be erased at runtime, but `eslint.config.mjs` blocks the import
 * unconditionally so the architectural boundary stays loud at lint time
 * rather than failing months later when a team-only install can't load
 * better-sqlite3.
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
  EvalCase,
  EvalCaseKind,
  EvalRunResult,
  FeedbackEvent,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  MetabolismRun,
  RetrievalContext,
  CuratedContext,
  AssembledContext,
  SaveObservationInput,
  Session,
  EvolutionRunResult,
  AddKnowledgeResult,
  AcceptInternalizationSuggestionsResult,
  InstallBundleResult,
  InternalizationSuggestions,
  PortableContextBundle,
  ProjectGraphOverlay,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  PublishBundleOptions,
  PublishBundleResult,
  SkillEvolutionEvaluation,
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  SkillEvolutionPatch,
  SkillEvolutionPatchStatus,
} from '@mindstrate/protocol';

export interface InstallBundleFromRegistryOptions {
  registry: string;
  reference: string;
}

export type InternalizationTarget = 'agents_md' | 'project_snapshot' | 'system_prompt' | 'fine_tune_dataset';

export interface BundleCreateOptions {
  name: string;
  version?: string;
  description?: string;
  project?: string;
  nodeIds?: string[];
  includeRelatedEdges?: boolean;
}

export interface ContextEventInput {
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
}

export interface ContextGraphQueryOptions {
  query?: string;
  project?: string;
  substrateType?: string;
  domainType?: ContextDomainType;
  status?: ContextNodeStatus;
  limit?: number;
}

export interface ContextEdgeQueryOptions {
  sourceId?: string;
  targetId?: string;
  relationType?: string;
  limit?: number;
}

export interface ProjectGraphOverlayInput {
  project: string;
  target?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  kind: ProjectGraphOverlayKind;
  content: string;
  author?: string;
  source: ProjectGraphOverlaySource;
}

export interface ProjectGraphOverlayQueryOptions {
  project?: string;
  target?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  limit?: number;
}

// ============================================================
// Local-mode subdomain shapes
//
// Structural mirror of @mindstrate/server's Mindstrate facade so we can
// type the local-mode handle without importing the server package. Each
// LocalXxxSubApi corresponds to one runtime/mindstrate-*-api.ts class.
// ============================================================

export interface LocalKnowledgeSubApi {
  add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult>;
}

export interface LocalContextSubApi {
  readGraphKnowledge(options?: { project?: string; limit?: number }): GraphKnowledgeView[];
  queryGraphKnowledge(
    query: string,
    options?: {
      project?: string;
      topK?: number;
      limit?: number;
      trackFeedback?: boolean;
      sessionId?: string;
    },
  ): GraphKnowledgeSearchResult[];
  queryContextGraph(options?: ContextGraphQueryOptions): ContextNode[];
  listContextEdges(options?: ContextEdgeQueryOptions): ContextEdge[];
  listConflictRecords(project?: string, limit?: number): ConflictRecord[];
  createProjectGraphOverlay(input: ProjectGraphOverlayInput): ProjectGraphOverlay;
  listProjectGraphOverlays(options?: ProjectGraphOverlayQueryOptions): ProjectGraphOverlay[];
  recordFeedback(retrievalId: string, signal: FeedbackEvent['signal'], context?: string): boolean;
  /**
   * Run the project graph scanner against `project.root` and reconcile
   * the result with the existing ECS graph. Used by the
   * `reindex_project_graph` MCP tool to recover from a stale db without
   * forcing the user out of the agent loop.
   */
  indexProjectGraph(project: import('@mindstrate/server').DetectedProject): {
    project: string;
    filesScanned: number;
    nodesCreated: number;
    nodesUpdated: number;
    edgesCreated: number;
    edgesUpdated: number;
    edgesSkipped: number;
  };
}

export interface LocalEventsSubApi {
  ingestEvent(input: ContextEventInput): { event: ContextEvent; node: ContextNode; previousNodeId?: string };
}

export interface LocalSessionsSubApi {
  startSession(input: { project?: string; techContext?: string }): Promise<Session>;
  saveObservation(input: SaveObservationInput): void;
  compressSession(input: { sessionId: string; summary: string; openTasks?: string[] }): void;
  endSession(sessionId: string): Promise<void>;
  getSession(id: string): Session | null;
  getActiveSession(project: string): Session | null;
  formatSessionContext(project: string): string;
}

export interface LocalAssemblySubApi {
  curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext>;
  assembleContext(
    task: string,
    options?: { project?: string; context?: RetrievalContext; sessionId?: string },
  ): Promise<AssembledContext>;
}

export interface LocalMetabolismSubApi {
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  runDigest(options?: { project?: string }): unknown;
  runAssimilation(options?: { project?: string }): unknown;
  runCompression(options?: { project?: string }): Promise<unknown>;
  runPruning(options?: { project?: string }): unknown;
  runReflection(options?: { project?: string }): unknown;
  runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult>;
  acceptConflictCandidate(input: { conflictId: string; candidateNodeId: string; resolution: string }): { resolved: ConflictRecord | null };
  rejectConflictCandidate(input: { conflictId: string; candidateNodeId: string; reason: string }): { rejectedNode: unknown };
}

export interface LocalBundlesSubApi {
  createBundle(options: BundleCreateOptions): PortableContextBundle;
  validateBundle(bundle: PortableContextBundle): { valid: boolean; errors: string[] };
  installBundle(bundle: PortableContextBundle): InstallBundleResult;
  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult>;
  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): PublishBundleResult;
}

export interface LocalProjectionsSubApi {
  generateInternalizationSuggestions(options?: { project?: string; limit?: number }): InternalizationSuggestions;
  acceptInternalizationSuggestions(options?: { project?: string; limit?: number; targets?: InternalizationTarget[] }): AcceptInternalizationSuggestionsResult;
  writeObsidianProjectionFiles(options: { rootDir: string; project?: string; limit?: number }): string[];
  importObsidianProjectionFile(filePath: string): { sourceNodeId?: string; candidateNode?: unknown; event?: unknown; changed: boolean };
  renderBestSkillArtifact(options?: { project?: string; limit?: number }): BestSkillArtifact;
}

export interface LocalMaintenanceSubApi {
  getStats(): Promise<unknown>;
}

export interface SkillEvolutionListOptions {
  project?: string;
  sourceNodeId?: string;
  status?: SkillEvolutionPatchStatus;
  limit?: number;
}

export interface SkillEvolutionEvaluateInput {
  patchId: string;
  evaluator: SkillEvolutionEvaluator;
  metric: SkillEvolutionMetric;
  baselineScore: number;
  candidateScore: number;
  details?: unknown;
}

export interface LocalSkillEvolutionSubApi {
  listSkillPatches(options?: SkillEvolutionListOptions): SkillEvolutionPatch[];
  getSkillPatch(id: string): SkillEvolutionPatch | null;
  evaluateSkillPatchScoreGate(input: SkillEvolutionEvaluateInput): SkillEvolutionEvaluation;
  rejectSkillPatch(input: { patchId: string; reason: string; metadata?: Record<string, unknown> }): SkillEvolutionPatch | null;
  optimizeSkillTargets(options?: { project?: string; limit?: number }): Promise<Array<{ nodeId: string; outcome: string; patchId?: string; evaluationId?: string }>>;
  transferVerifiedSkills(input: { fromProject: string; toProject: string; limit?: number }): { transferred: number; skipped: number; targetNodeIds: string[] };
}

export interface BestSkillArtifact {
  markdown: string;
  sourceNodeIds: string[];
}

export interface LocalMemory {
  init(): Promise<void>;
  close(): void;
  readonly knowledge: LocalKnowledgeSubApi;
  readonly context: LocalContextSubApi;
  readonly events: LocalEventsSubApi;
  readonly sessions: LocalSessionsSubApi;
  readonly assembly: LocalAssemblySubApi;
  readonly metabolism: LocalMetabolismSubApi & LocalSkillEvolutionSubApi;
  readonly evaluation: {
    evaluateSkillPatchScoreGate(input: SkillEvolutionEvaluateInput): SkillEvolutionEvaluation;
    addEvalCase(query: string, expectedIds: string[], options?: { language?: string; framework?: string; kind?: EvalCaseKind }): EvalCase;
    listEvalCases(options?: { kind?: EvalCaseKind }): EvalCase[];
    deleteEvalCase(id: string): boolean;
    runEvaluation(topK?: number, options?: { kind?: EvalCaseKind }): Promise<EvalRunResult>;
  };
  readonly bundles: LocalBundlesSubApi;
  readonly projections: LocalProjectionsSubApi;
  readonly maintenance: LocalMaintenanceSubApi;
}

export interface KnowledgeApi {
  init(): Promise<void>;
  add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult>;
  get(id: string): Promise<GraphKnowledgeView | null>;
  getStats(): Promise<unknown>;
  recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string): Promise<boolean>;
  curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext>;
  assembleContext(task: string, options?: { project?: string; context?: RetrievalContext; sessionId?: string }): Promise<AssembledContext>;
  runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult>;
  readGraphKnowledge(opts?: { project?: string; limit?: number }): Promise<GraphKnowledgeView[]>;
  queryGraphKnowledge(query: string, opts?: { project?: string; topK?: number; limit?: number }): Promise<GraphKnowledgeSearchResult[]>;
}

export interface SessionApi {
  startSession(project: string, techContext?: string): Promise<{ session: Session; context: string | null }>;
  saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>): Promise<void>;
  endSession(sessionId: string, summary?: string, openTasks?: string[]): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  getActiveSession(project: string): Promise<Session | null>;
  formatSessionContext(project: string): Promise<string | null>;
}

export interface ContextGraphApi {
  ingestContextEvent(input: ContextEventInput): Promise<{ eventId: string; nodeId: string }>;
  queryContextGraph(options?: ContextGraphQueryOptions): Promise<ContextNode[]>;
  listContextEdges(options?: ContextEdgeQueryOptions): Promise<ContextEdge[]>;
  listContextConflicts(options?: { project?: string; limit?: number }): Promise<ConflictRecord[]>;
  createProjectGraphOverlay(input: ProjectGraphOverlayInput): Promise<ProjectGraphOverlay>;
  listProjectGraphOverlays(options?: ProjectGraphOverlayQueryOptions): Promise<ProjectGraphOverlay[]>;
  acceptConflictCandidate(input: { conflictId: string; candidateNodeId: string; resolution: string }): Promise<{ resolved: ConflictRecord | null }>;
  rejectConflictCandidate(input: { conflictId: string; candidateNodeId: string; reason: string }): Promise<{ rejected: boolean } | { rejectedNode: unknown }>;
  /**
   * Rebuild the project graph from the filesystem rooted at `cwd`. Used
   * to recover from a stale db (e.g. the original `mindstrate setup` ran
   * before the project gained new source roots) without forcing the user
   * to leave the MCP loop. Returns a coarse stats object the handler
   * surfaces to the AI so the user can see what changed.
   */
  reindexProjectGraph(input: { cwd?: string }): Promise<{
    project: string;
    filesScanned: number;
    nodesCreated: number;
    nodesUpdated: number;
    edgesCreated: number;
    edgesUpdated: number;
    edgesSkipped: number;
  }>;
}

export interface MetabolismApi {
  runMetabolism(options?: { project?: string; trigger?: 'manual' | 'scheduled' | 'event_driven' }): Promise<MetabolismRun>;
  runMetabolismStage(stage: 'digest' | 'assimilate' | 'compress' | 'prune' | 'reflect', options?: { project?: string }): Promise<unknown>;
}

export interface BundleApi {
  createBundle(options: BundleCreateOptions): Promise<PortableContextBundle>;
  validateBundle(bundle: PortableContextBundle): Promise<{ valid: boolean; errors: string[] }>;
  installBundle(bundle: PortableContextBundle): Promise<InstallBundleResult>;
  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult>;
  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): Promise<PublishBundleResult>;
}

export interface InternalizationApi {
  generateInternalizationSuggestions(options?: { project?: string; limit?: number }): Promise<InternalizationSuggestions>;
  acceptInternalizationSuggestions(options?: { project?: string; limit?: number; targets?: InternalizationTarget[] }): Promise<AcceptInternalizationSuggestionsResult>;
  writeObsidianProjectionFiles(options: { rootDir: string; project?: string; limit?: number }): Promise<{ files: string[] }>;
  importObsidianProjectionFile(filePath: string): Promise<{ sourceNodeId?: string; candidateNode?: unknown; event?: unknown; changed: boolean }>;
}

export interface SkillOptimizationResult {
  nodeId: string;
  outcome: string;
  patchId?: string;
  evaluationId?: string;
}

export interface SkillTransferResult {
  transferred: number;
  skipped: number;
  targetNodeIds: string[];
}

export interface SkillEvolutionApi {
  listSkillPatches(options?: SkillEvolutionListOptions): Promise<SkillEvolutionPatch[]>;
  getSkillPatch(id: string): Promise<SkillEvolutionPatch | null>;
  evaluateSkillPatch(input: SkillEvolutionEvaluateInput): Promise<SkillEvolutionEvaluation>;
  rejectSkillPatch(input: { patchId: string; reason: string; metadata?: Record<string, unknown> }): Promise<SkillEvolutionPatch | null>;
  renderBestSkillArtifact(options?: { project?: string; limit?: number }): Promise<BestSkillArtifact>;
  optimizeSkillTargets(options?: { project?: string; limit?: number }): Promise<SkillOptimizationResult[]>;
  transferVerifiedSkills(input: { fromProject: string; toProject: string; limit?: number }): Promise<SkillTransferResult>;
}

export interface EvalApi {
  listEvalCases(options?: { kind?: EvalCaseKind }): Promise<EvalCase[]>;
  addEvalCase(input: { query: string; expectedIds: string[]; language?: string; framework?: string; kind?: EvalCaseKind }): Promise<EvalCase>;
  deleteEvalCase(id: string): Promise<{ deleted: boolean }>;
  runEvalDataset(options?: { topK?: number; kind?: EvalCaseKind }): Promise<EvalRunResult>;
}

export interface McpApi
  extends KnowledgeApi,
    SessionApi,
    ContextGraphApi,
    MetabolismApi,
    BundleApi,
    InternalizationApi,
    SkillEvolutionApi,
    EvalApi {
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
