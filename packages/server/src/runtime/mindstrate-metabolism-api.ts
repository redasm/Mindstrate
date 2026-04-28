import type { EvolutionRunResult, EvolutionSuggestion } from '@mindstrate/protocol';
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
import type { MetabolismRun } from '@mindstrate/protocol/models';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateMetabolismApi {
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

  listMetabolismRuns(project?: string, limit?: number): MetabolismRun[] {
    return this.services.contextGraphStore.listMetabolismRuns({ project, limit });
  }
}

