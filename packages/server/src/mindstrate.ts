/**
 * Mindstrate - Main Entry (Facade)
 *
 * The class is intentionally thin: runtime construction and lifecycle stay
 * here, while graph, session, bundle and operations behavior live in focused
 * API modules.
 */

import type {
  AddKnowledgeResult,
  AssembledContext,
  CompressSessionInput,
  CreateKnowledgeInput,
  CreateSessionInput,
  EvolutionRunResult,
  EvolutionSuggestion,
  FeedbackEvent,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  RetrievalContext,
  SaveObservationInput,
  Session,
  SessionContext,
} from '@mindstrate/protocol';
import type {
  ConflictRecord,
  ContextEdge,
  ContextEvent,
  ContextNode,
  ContextNodeStatus,
  CuratedContext,
  MetabolismRun,
  PortableContextBundle,
  ProjectionRecord,
} from '@mindstrate/protocol/models';
import { ContextDomainType, SubstrateType } from '@mindstrate/protocol/models';
import type { MindstrateConfig } from './config.js';
import type { IVectorStore } from './storage/vector-store-interface.js';
import type { QualityGateResult } from '@mindstrate/protocol';
import type { EvalRunResult } from './quality/eval.js';
import type { DetectedProject } from './project/index.js';
import type { CreateContextNodeInput, UpdateContextNodeInput } from './context-graph/context-graph-store.js';
import type { GraphKnowledgeProjectionOptions } from './context-graph/knowledge-projector.js';
import type { ProjectedKnowledgeSearchOptions } from './context-graph/projected-knowledge-search.js';
import type {
  AcceptInternalizationSuggestionsOptions,
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestionOptions,
  InternalizationSuggestions,
} from './context-graph/context-internalizer.js';
import type {
  AcceptReflectionCandidateResult,
  ConflictReflectionOptions,
  ConflictReflectionResult,
  RejectReflectionCandidateResult,
} from './context-graph/conflict-reflector.js';
import type { ConflictDetectionOptions, ConflictDetectionResult } from './context-graph/conflict-detector.js';
import type { PatternCompressionOptions, PatternCompressionResult } from './context-graph/pattern-compressor.js';
import type { RuleCompressionOptions, RuleCompressionResult } from './context-graph/rule-compressor.js';
import type { SummaryCompressionOptions, SummaryCompressionResult } from './context-graph/summary-compressor.js';
import type {
  CreateBundleOptions,
  EditableBundleFiles,
  InstallBundleFromRegistryOptions,
  InstallBundleResult,
  InstallEditableBundleFilesResult,
  PublishBundleOptions,
  PublishBundleResult,
  ValidateBundleResult,
} from './bundles/index.js';
import type {
  MetabolismSchedulerOptions,
  PruneOptions,
  PruneResult,
  RunMetabolismOptions,
} from './metabolism/index.js';
import type { IngestContextEventInput } from './events/index.js';
import { createMindstrateRuntime, type MindstrateRuntime } from './runtime/mindstrate-runtime.js';
import { MindstrateBundleApi } from './runtime/mindstrate-bundle-api.js';
import { MindstrateGraphApi } from './runtime/mindstrate-graph-api.js';
import { MindstrateOperationsApi } from './runtime/mindstrate-operations-api.js';
import { MindstrateSessionApi } from './runtime/mindstrate-session-api.js';

export class Mindstrate {
  private readonly services: MindstrateRuntime;
  private readonly graph: MindstrateGraphApi;
  private readonly operations: MindstrateOperationsApi;
  readonly bundles: MindstrateBundleApi;
  readonly sessions: MindstrateSessionApi;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(configOverrides?: Partial<MindstrateConfig> & {
    vectorStore?: IVectorStore;
  }) {
    this.services = createMindstrateRuntime(configOverrides, (query, options) =>
      this.queryGraphKnowledge(query, { topK: options.topK, trackFeedback: false })
        .map((result) => result.view.id),
    );
    this.bundles = new MindstrateBundleApi(this.services);
    this.sessions = new MindstrateSessionApi(this.services);
    this.graph = new MindstrateGraphApi(
      this.services,
      () => this.ensureInit(),
      (project) => this.sessions.formatSessionContext(project),
    );
    this.operations = new MindstrateOperationsApi(this.services, () => this.ensureInit());
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.services.vectorStore.initialize()
        .then(() => {
          this.initialized = true;
        })
        .catch((err) => {
          this.initPromise = null;
          throw err;
        });
    }
    return this.initPromise;
  }

  async add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult> {
    return this.graph.add(input);
  }

  async upsertProjectSnapshot(
    project: DetectedProject,
    options: { author?: string; trusted?: boolean } = {},
  ): Promise<{ node: ContextNode; view: GraphKnowledgeView; changed: boolean; created: boolean }> {
    return this.graph.upsertProjectSnapshot(project, options);
  }

  getProjectSnapshot(project: DetectedProject): ContextNode | null {
    return this.graph.getProjectSnapshot(project);
  }

  checkQuality(input: CreateKnowledgeInput): QualityGateResult {
    return this.graph.checkQuality(input);
  }

  curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    sessionId?: string,
  ): Promise<CuratedContext> {
    return this.graph.curateContext(taskDescription, context, sessionId);
  }

  assembleContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    return this.graph.assembleContext(taskDescription, options);
  }

  assembleWorkingContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    return this.graph.assembleWorkingContext(taskDescription, options);
  }

  updateContextNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.graph.updateContextNode(id, input);
  }

  createContextNode(input: CreateContextNodeInput): ContextNode {
    return this.graph.createContextNode(input);
  }

  deleteContextNode(id: string): boolean {
    return this.graph.deleteContextNode(id);
  }

  upvote(id: string): void {
    this.graph.upvote(id);
  }

  downvote(id: string): void {
    this.graph.downvote(id);
  }

  recordFeedback(
    retrievalId: string,
    signal: FeedbackEvent['signal'],
    context?: string,
  ): void {
    this.graph.recordFeedback(retrievalId, signal, context);
  }

  getFeedbackStats(nodeId: string) {
    return this.graph.getFeedbackStats(nodeId);
  }

  runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    return this.operations.runEvolution(options);
  }

  applyEvolutionSuggestion(suggestion: EvolutionSuggestion): boolean {
    return this.operations.applyEvolutionSuggestion(suggestion);
  }

  runEvaluation(topK?: number): Promise<EvalRunResult> {
    return this.operations.runEvaluation(topK);
  }

  addEvalCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
  }) {
    return this.operations.addEvalCase(query, expectedIds, options);
  }

  getEvalTrend(limit?: number) {
    return this.operations.getEvalTrend(limit);
  }

  startSession(input: CreateSessionInput = {}): Promise<Session> {
    return this.sessions.startSession(input);
  }

  saveObservation(input: SaveObservationInput): void {
    this.sessions.saveObservation(input);
  }

  ingestEvent(input: IngestContextEventInput): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return this.graph.ingestEvent(input);
  }

  ingestGitActivity(input: {
    content: string;
    project?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return this.graph.ingestGitActivity(input);
  }

  ingestTestRun(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return this.graph.ingestTestRun(input);
  }

  ingestLspDiagnostic(input: {
    content: string;
    project?: string;
    sessionId?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return this.graph.ingestLspDiagnostic(input);
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
    return this.graph.ingestTerminalOutput(input);
  }

  compressSession(input: CompressSessionInput): void {
    this.sessions.compressSession(input);
  }

  autoCompressSession(sessionId: string): Promise<CompressSessionInput | null> {
    return this.sessions.autoCompressSession(sessionId);
  }

  endSession(sessionId: string): Promise<void> {
    return this.sessions.endSession(sessionId);
  }

  restoreSessionContext(project: string = ''): SessionContext {
    return this.sessions.restoreSessionContext(project);
  }

  formatSessionContext(project: string = ''): string {
    return this.sessions.formatSessionContext(project);
  }

  getActiveSession(project: string = ''): Session | null {
    return this.sessions.getActiveSession(project);
  }

  getSession(id: string): Session | null {
    return this.sessions.getSession(id);
  }

  getRecentSessions(project: string = '', limit: number = 10): Session[] {
    return this.sessions.getRecentSessions(project, limit);
  }

  runSummaryCompression(options?: SummaryCompressionOptions): Promise<SummaryCompressionResult> {
    return this.operations.runSummaryCompression(options);
  }

  runPatternCompression(options?: PatternCompressionOptions): Promise<PatternCompressionResult> {
    return this.operations.runPatternCompression(options);
  }

  runRuleCompression(options?: RuleCompressionOptions): Promise<RuleCompressionResult> {
    return this.operations.runRuleCompression(options);
  }

  runConflictDetection(options?: ConflictDetectionOptions): Promise<ConflictDetectionResult> {
    return this.operations.runConflictDetection(options);
  }

  runConflictReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.operations.runConflictReflection(options);
  }

  runMetabolism(options?: RunMetabolismOptions): Promise<MetabolismRun> {
    return this.operations.runMetabolism(options);
  }

  startMetabolismScheduler(options: Omit<MetabolismSchedulerOptions, 'runMetabolism'>): void {
    this.operations.startMetabolismScheduler(options);
  }

  stopMetabolismScheduler(): void {
    this.operations.stopMetabolismScheduler();
  }

  runDigest(options?: { project?: string }) {
    return this.operations.runDigest(options);
  }

  runAssimilation(options?: { project?: string }) {
    return this.operations.runAssimilation(options);
  }

  runCompression(options?: { project?: string }) {
    return this.operations.runCompression(options);
  }

  runPruning(options?: PruneOptions): PruneResult {
    return this.operations.runPruning(options);
  }

  runReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.operations.runReflection(options);
  }

  acceptConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    resolution: string;
  }): AcceptReflectionCandidateResult {
    return this.operations.acceptConflictCandidate(input);
  }

  rejectConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    reason: string;
  }): RejectReflectionCandidateResult {
    return this.operations.rejectConflictCandidate(input);
  }

  projectSessionSummaries(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.operations.projectSessionSummaries(options);
  }

  projectProjectSnapshots(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.operations.projectProjectSnapshots(options);
  }

  projectObsidianDocuments(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.operations.projectObsidianDocuments(options);
  }

  writeObsidianProjectionFiles(options: { project?: string; limit?: number; rootDir: string }): string[] {
    return this.operations.writeObsidianProjectionFiles(options);
  }

  importObsidianProjectionFile(filePath: string) {
    return this.operations.importObsidianProjectionFile(filePath);
  }

  generateInternalizationSuggestions(options?: InternalizationSuggestionOptions): InternalizationSuggestions {
    return this.operations.generateInternalizationSuggestions(options);
  }

  acceptInternalizationSuggestions(options?: AcceptInternalizationSuggestionsOptions): AcceptInternalizationSuggestionsResult {
    return this.operations.acceptInternalizationSuggestions(options);
  }

  listContextNodes(options?: {
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    sourceRef?: string;
    limit?: number;
  }): ContextNode[] {
    return this.graph.listContextNodes(options);
  }

  listConflictRecords(project?: string, limit?: number): ConflictRecord[] {
    return this.graph.listConflictRecords(project, limit);
  }

  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: import('@mindstrate/protocol/models').ContextRelationType;
    limit?: number;
  }): ContextEdge[] {
    return this.graph.listContextEdges(options);
  }

  queryContextGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): ContextNode[] {
    return this.graph.queryContextGraph(options);
  }

  listProjectionRecords(options?: { nodeId?: string; target?: string; limit?: number }): ProjectionRecord[] {
    return this.operations.listProjectionRecords(options);
  }

  listMetabolismRuns(project?: string, limit?: number): MetabolismRun[] {
    return this.operations.listMetabolismRuns(project, limit);
  }

  createBundle(options: CreateBundleOptions): PortableContextBundle {
    return this.bundles.createBundle(options);
  }

  validateBundle(bundle: PortableContextBundle): ValidateBundleResult {
    return this.bundles.validateBundle(bundle);
  }

  installBundle(bundle: PortableContextBundle): InstallBundleResult {
    return this.bundles.installBundle(bundle);
  }

  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult> {
    return this.bundles.installBundleFromRegistry(options);
  }

  publishBundle(bundle: PortableContextBundle, options?: PublishBundleOptions): PublishBundleResult {
    return this.bundles.publishBundle(bundle, options);
  }

  createEditableBundleFiles(bundle: PortableContextBundle): EditableBundleFiles {
    return this.bundles.createEditableBundleFiles(bundle);
  }

  installEditableBundleFiles(files: EditableBundleFiles): InstallEditableBundleFilesResult {
    return this.bundles.installEditableBundleFiles(files);
  }

  installEditableBundleDirectory(directory: string): InstallEditableBundleFilesResult {
    return this.bundles.installEditableBundleDirectory(directory);
  }

  readGraphKnowledge(options?: GraphKnowledgeProjectionOptions): GraphKnowledgeView[] {
    return this.graph.readGraphKnowledge(options);
  }

  queryGraphKnowledge(query: string, options?: ProjectedKnowledgeSearchOptions): GraphKnowledgeSearchResult[] {
    return this.graph.queryGraphKnowledge(query, options);
  }

  runMaintenance(): {
    total: number;
    updated: number;
    outdated: number;
  } {
    return this.operations.runMaintenance();
  }

  getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
    vectorCount: number;
    feedbackStats: {
      totalEvents: number;
      last30Days: number;
      avgAdoptionRate: number;
    };
  }> {
    return this.operations.getStats();
  }

  close(): void {
    this.stopMetabolismScheduler();
    this.services.vectorStore.flush();
    this.services.databaseStore.close();
  }

  getConfig(): Readonly<MindstrateConfig> {
    return this.services.config;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }
}

