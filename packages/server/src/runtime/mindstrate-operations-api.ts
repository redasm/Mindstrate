import type { EvolutionRunResult, EvolutionSuggestion } from '@mindstrate/protocol';
import type {
  AcceptInternalizationSuggestionsOptions,
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestionOptions,
  InternalizationSuggestions,
} from '../context-graph/context-internalizer.js';
import type {
  AcceptReflectionCandidateResult,
  ConflictReflectionOptions,
  ConflictReflectionResult,
  RejectReflectionCandidateResult,
} from '../context-graph/conflict-reflector.js';
import type { ConflictDetectionOptions, ConflictDetectionResult } from '../context-graph/conflict-detector.js';
import type { PatternCompressionOptions, PatternCompressionResult } from '../context-graph/pattern-compressor.js';
import type { RuleCompressionOptions, RuleCompressionResult } from '../context-graph/rule-compressor.js';
import type { SummaryCompressionOptions, SummaryCompressionResult } from '../context-graph/summary-compressor.js';
import type {
  MetabolismSchedulerOptions,
  PruneOptions,
  PruneResult,
  RunMetabolismOptions,
} from '../metabolism/index.js';
import { MetabolismScheduler } from '../metabolism/index.js';
import type { EvalRunResult } from '../quality/eval.js';
import { getGraphStats } from '../mindstrate-graph-helpers.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';
import type { MetabolismRun, ProjectionRecord } from '@mindstrate/protocol/models';

export class MindstrateOperationsApi {
  private metabolismScheduler: MetabolismScheduler | null = null;

  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {}

  async runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    await this.ensureInit();
    const run = await this.runMetabolism({ trigger: 'manual' });
    const scanned = Object.values(run.stageStats)
      .reduce((sum, stats) => sum + (stats?.scanned ?? 0), 0);
    return {
      mode: options?.mode ?? 'standard',
      scanned,
      suggestions: [],
      summary: { merge: 0, improve: 0, validate: 0, archive: 0, split: 0 },
      llmEnhanced: 0,
      autoApplied: 0,
      pendingReview: 0,
    };
  }

  applyEvolutionSuggestion(suggestion: EvolutionSuggestion): boolean {
    return this.services.contextGraphStore.getNodeById(suggestion.nodeId) !== null;
  }

  async runEvaluation(topK?: number): Promise<EvalRunResult> {
    await this.ensureInit();
    return this.services.evaluator.runEvaluation(topK);
  }

  addEvalCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
  }) {
    return this.services.evaluator.addCase(query, expectedIds, options);
  }

  getEvalTrend(limit?: number) {
    return this.services.evaluator.getTrend(limit);
  }

  async runSummaryCompression(options?: SummaryCompressionOptions): Promise<SummaryCompressionResult> {
    await this.ensureInit();
    return this.services.summaryCompressor.compressProjectSnapshots(options);
  }

  async runPatternCompression(options?: PatternCompressionOptions): Promise<PatternCompressionResult> {
    await this.ensureInit();
    return this.services.patternCompressor.compressProjectSummaries(options);
  }

  async runRuleCompression(options?: RuleCompressionOptions): Promise<RuleCompressionResult> {
    await this.ensureInit();
    return this.services.ruleCompressor.compressProjectPatterns(options);
  }

  async runConflictDetection(options?: ConflictDetectionOptions): Promise<ConflictDetectionResult> {
    await this.ensureInit();
    return this.services.conflictDetector.detectConflicts(options);
  }

  runConflictReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.services.conflictReflector.reflectConflicts(options);
  }

  async runMetabolism(options?: RunMetabolismOptions): Promise<MetabolismRun> {
    await this.ensureInit();
    return this.services.metabolismEngine.run(options);
  }

  startMetabolismScheduler(options: Omit<MetabolismSchedulerOptions, 'runMetabolism'>): void {
    this.stopMetabolismScheduler();
    this.metabolismScheduler = new MetabolismScheduler({
      ...options,
      runMetabolism: (runOptions) => this.runMetabolism(runOptions),
    });
    this.metabolismScheduler.start();
  }

  stopMetabolismScheduler(): void {
    this.metabolismScheduler?.stop();
    this.metabolismScheduler = null;
  }

  runDigest(options?: { project?: string }) {
    return this.services.metabolismEngine.runDigest(options);
  }

  runAssimilation(options?: { project?: string }) {
    return this.services.metabolismEngine.runAssimilation(options);
  }

  async runCompression(options?: { project?: string }) {
    await this.ensureInit();
    return this.services.metabolismEngine.runCompression(options);
  }

  runPruning(options?: PruneOptions): PruneResult {
    return this.services.pruner.prune(options);
  }

  runReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.runConflictReflection(options);
  }

  acceptConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    resolution: string;
  }): AcceptReflectionCandidateResult {
    return this.services.conflictReflector.acceptCandidate(input);
  }

  rejectConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    reason: string;
  }): RejectReflectionCandidateResult {
    return this.services.conflictReflector.rejectCandidate(input);
  }

  projectSessionSummaries(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.sessionProjectionMaterializer.materialize(options);
  }

  projectProjectSnapshots(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.projectSnapshotProjectionMaterializer.materialize(options);
  }

  projectObsidianDocuments(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.services.obsidianProjectionMaterializer.materialize(options);
  }

  writeObsidianProjectionFiles(options: { project?: string; limit?: number; rootDir: string }): string[] {
    return this.services.obsidianProjectionMaterializer.writeFiles(options);
  }

  importObsidianProjectionFile(filePath: string) {
    return this.services.obsidianProjectionMaterializer.importFile(filePath);
  }

  generateInternalizationSuggestions(options?: InternalizationSuggestionOptions): InternalizationSuggestions {
    return this.services.contextInternalizer.generateSuggestions(options);
  }

  acceptInternalizationSuggestions(options?: AcceptInternalizationSuggestionsOptions): AcceptInternalizationSuggestionsResult {
    return this.services.contextInternalizer.acceptSuggestions(options);
  }

  listProjectionRecords(options?: { nodeId?: string; target?: string; limit?: number }): ProjectionRecord[] {
    return this.services.contextGraphStore.listProjectionRecords(options);
  }

  listMetabolismRuns(project?: string, limit?: number): MetabolismRun[] {
    return this.services.contextGraphStore.listMetabolismRuns({ project, limit });
  }

  runMaintenance(): {
    total: number;
    updated: number;
    outdated: number;
  } {
    return {
      total: this.services.contextGraphStore.listNodes({ limit: 100000 }).length,
      updated: 0,
      outdated: 0,
    };
  }

  async getStats(): Promise<{
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
    const nodes = this.services.contextGraphStore.listNodes({ limit: 100000 });
    const dbStats = getGraphStats(nodes);
    const vectorCount = await this.services.vectorStore.count();
    const feedbackStats = this.services.feedbackLoop.getGlobalStats();

    return {
      ...dbStats,
      vectorCount,
      feedbackStats: {
        totalEvents: feedbackStats.totalEvents,
        last30Days: feedbackStats.last30Days,
        avgAdoptionRate: feedbackStats.avgAdoptionRate,
      },
    };
  }
}

