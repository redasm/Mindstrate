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
  FeedbackCooccurrenceCompressionOptions,
  FeedbackCooccurrenceCompressionResult,
} from '../context-graph/feedback-cooccurrence-compressor.js';
import type {
  MetabolismSchedulerOptions,
  PruneOptions,
  PruneResult,
  RunMetabolismOptions,
} from '../metabolism/index.js';
import { EvolutionEngine, MetabolismScheduler } from '../metabolism/index.js';
import {
  generateEvalCasesFromKnowledge,
  type GenerateEvalCasesResult,
} from '../quality/eval-case-generator.js';
import type { MetabolismRun } from '@mindstrate/protocol/models';
import type {
  SkillEvolutionPatch,
  SkillEvolutionPatchOperation,
  SkillEvolutionPatchStatus,
  SkillEvolutionPatchBudget,
} from '@mindstrate/protocol/models';
import type { MindstrateRuntime } from './mindstrate-runtime.js';
import {
  collectSkillOptimizationTargets,
  createLlmSkillPatchProposer,
  SkillEvolutionOptimizer,
  synthesizeMetaSkill,
  transferVerifiedSkills,
  validateSkillEvolutionPatchBudget,
  type MetaSkillSynthesisResult,
  type ScoreCandidateInput,
  type SkillPatchScore,
  type SkillEvolutionOptimizationResult,
  type SkillTransferResult,
} from '../skill-evolution/index.js';

export class MindstrateMetabolismApi {
  private metabolismScheduler: MetabolismScheduler | null = null;
  private readonly evolutionEngine: EvolutionEngine;

  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {
    this.evolutionEngine = new EvolutionEngine(this.services.contextGraphStore, this.services.pruner);
  }

  async runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    await this.ensureInit();
    await this.runMetabolism({ trigger: options?.mode === 'background' ? 'scheduled' : 'manual' });
    return this.evolutionEngine.run(options);
  }

  applyEvolutionSuggestion(suggestion: EvolutionSuggestion): boolean {
    return this.evolutionEngine.applySuggestion(suggestion);
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

  /**
   * Compress co-used project graph nodes (file / module / dependency /
   * asset facts the AI marked `adopted` or `partial` together via
   * `memory_feedback_auto`) into a `PATTERN + ARCHITECTURE` node.
   *
   * Bridges raw project graph nodes (which are `SNAPSHOT + ARCHITECTURE`
   * and therefore invisible to `ContextPrioritySelector`) into the
   * substrate the assembly priority selector actually picks from. Each
   * created PATTERN gets `SUPPORTS` edges back to its source nodes so
   * `ProjectedKnowledgeSearch.findBestSupportingEvidence` can walk back
   * to the underlying evidence.
   *
   * No-LLM, deterministic, and idempotent: same source set ⇒ same
   * deterministic id ⇒ update-in-place across reruns.
   */
  async runFeedbackCooccurrenceCompression(
    options?: FeedbackCooccurrenceCompressionOptions,
  ): Promise<FeedbackCooccurrenceCompressionResult> {
    await this.ensureInit();
    return this.services.feedbackCooccurrenceCompressor.compress(options);
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

  startMetabolismScheduler(
    options: Omit<
      MetabolismSchedulerOptions,
      'runMetabolism' | 'optimizeSkills' | 'generateEvalCases'
    > & {
      /** Also run skill-evolution optimization on the scheduler cadence. */
      optimizeSkills?: boolean;
      /** Also auto-generate retrieval eval cases on the scheduler cadence. */
      generateEvalCases?: boolean;
    },
  ): void {
    this.stopMetabolismScheduler();
    const { optimizeSkills, generateEvalCases, ...schedulerOptions } = options;
    this.metabolismScheduler = new MetabolismScheduler({
      ...schedulerOptions,
      runMetabolism: (runOptions) => this.runMetabolism(runOptions),
      optimizeSkills: optimizeSkills
        ? (skillOptions) => this.optimizeSkillTargets(skillOptions)
        : undefined,
      generateEvalCases: generateEvalCases
        ? (genOptions) => this.generateScheduledEvalCases(genOptions)
        : undefined,
    });
    this.metabolismScheduler.start();
  }

  /**
   * Scheduler-driven eval dataset bootstrap. Mirrors
   * `MindstrateEvaluationApi.generateEvalCases` but wired straight from the
   * runtime services so the scheduler does not depend on the evaluation API
   * facade. Idempotent; only newly-covered knowledge yields new cases.
   */
  private generateScheduledEvalCases(options: { project?: string }): GenerateEvalCasesResult {
    return generateEvalCasesFromKnowledge(
      {
        projectKnowledge: (projectionOptions) =>
          this.services.graphKnowledgeProjector.project(projectionOptions),
        listCases: (listOptions) => this.services.evaluator.listCases(listOptions),
        addCase: (query, expectedIds, addOptions) =>
          this.services.evaluator.addCase(query, expectedIds, addOptions),
      },
      options,
    );
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

  proposeSkillPatch(input: {
    project?: string;
    sourceNodeId: string;
    targetNodeId?: string;
    operation: SkillEvolutionPatchOperation;
    beforeContent: string;
    afterContent: string;
    rationale: string;
    budget: SkillEvolutionPatchBudget;
    metadata?: Record<string, unknown>;
  }): SkillEvolutionPatch {
    const sourceNode = this.services.contextGraphStore.getNodeById(input.sourceNodeId);
    const budget = validateSkillEvolutionPatchBudget({
      sourceNode,
      operation: input.operation,
      beforeContent: input.beforeContent,
      afterContent: input.afterContent,
      budget: input.budget,
    });
    if (!budget.valid) {
      throw new Error(`Invalid skill evolution patch: ${budget.reason}`);
    }
    return this.services.skillEvolutionStore.createPatch({
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        budgetValidation: budget,
      },
    });
  }

  getSkillPatch(id: string): SkillEvolutionPatch | null {
    return this.services.skillEvolutionStore.getPatchById(id);
  }

  listSkillPatches(options: {
    project?: string;
    sourceNodeId?: string;
    status?: SkillEvolutionPatchStatus;
    limit?: number;
  } = {}): SkillEvolutionPatch[] {
    return this.services.skillEvolutionStore.listPatches(options);
  }

  rejectSkillPatch(input: { patchId: string; reason: string; metadata?: Record<string, unknown> }): SkillEvolutionPatch | null {
    return this.services.skillEvolutionStore.markPatchRejected(input.patchId, input.reason, input.metadata);
  }

  /**
   * Manual review approval: applies the candidate patch to its source node
   * (promoting CANDIDATE nodes to ACTIVE) after budget validation, without
   * fabricating evaluation scores. The reviewer identity is recorded in the
   * patch metadata for audit.
   */
  approveSkillPatch(input: { patchId: string; approvedBy?: string; note?: string }): SkillEvolutionPatch {
    return this.services.skillEvolutionGate.approvePatch(input);
  }

  /**
   * Run the SkillOpt-style optimizer over low-adoption / negative-feedback
   * high-order nodes. Targets come from real failure signals; an LLM
   * proposer suggests bounded patches that still pass the budget validator.
   * Until real before/after scoring exists the scorer reports zero eval
   * cases, so every proposal parks as `insufficient_data` for human review —
   * nothing is auto-applied and nothing is auto-rejected. Offline (no LLM
   * config) yields `no_proposal`.
   */
  async optimizeSkillTargets(options: {
    project?: string;
    limit?: number;
  } = {}): Promise<SkillEvolutionOptimizationResult[]> {
    await this.ensureInit();
    const targets = collectSkillOptimizationTargets(
      {
        graphStore: this.services.contextGraphStore,
        feedbackLoop: this.services.feedbackLoop,
      },
      { project: options.project, limit: options.limit },
    );
    if (targets.length === 0) return [];

    const proposePatch = createLlmSkillPatchProposer({
      providerFactory: this.services.providerFactory,
    });
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore: this.services.skillEvolutionStore,
      graphStore: this.services.contextGraphStore,
      gate: this.services.skillEvolutionGate,
      proposePatch,
      scoreCandidate: (input: ScoreCandidateInput) => this.scoreSkillCandidate(input),
    });
    return optimizer.optimizeTargets(targets);
  }

  private async scoreSkillCandidate(_input: ScoreCandidateInput): Promise<SkillPatchScore> {
    // No held-out before/after scoring exists yet (it would require
    // rebuilding the retrieval index per candidate). Report zero cases so
    // the gate parks the patch as `insufficient_data` for human review.
    // Reporting equal fake scores instead would auto-reject the patch and
    // fingerprint its content, permanently suppressing the same proposal
    // even after real scoring lands.
    return { totalCases: 0, baselineScore: 0, candidateScore: 0 };
  }

  /**
   * Synthesize a candidate meta-skill HEURISTIC summarizing how accepted
   * skill patches improved skills for this project. Candidate-first: the
   * gate or a human still decides promotion.
   */
  synthesizeMetaSkill(options: { project?: string; minAcceptedPatches?: number; limit?: number } = {}): MetaSkillSynthesisResult | null {
    return synthesizeMetaSkill(
      {
        graphStore: this.services.contextGraphStore,
        evolutionStore: this.services.skillEvolutionStore,
      },
      options,
    );
  }

  /**
   * Copy a source project's verified high-order skills into a target
   * project as candidates (cross-project transfer). The receiving
   * project's gate / reviewers decide promotion; lineage is preserved.
   */
  transferVerifiedSkills(options: { fromProject: string; toProject: string; limit?: number }): SkillTransferResult {
    return transferVerifiedSkills({ graphStore: this.services.contextGraphStore }, options);
  }
}
