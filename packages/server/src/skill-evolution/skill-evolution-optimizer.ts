import { createHash } from 'node:crypto';
import {
  SkillEvolutionPatchStatus,
  type SkillEvolutionPatch,
  type SkillEvolutionPatchBudget,
  type SkillEvolutionPatchOperation,
  type SkillEvolutionEvaluator,
  type SkillEvolutionMetric,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { validateSkillEvolutionPatchBudget } from './patch-budget.js';
import type { SkillEvolutionGate } from './evaluation-gate.js';
import type { SkillEvolutionStore } from './skill-evolution-store.js';

export interface SkillPatchProposal {
  operation: SkillEvolutionPatchOperation;
  afterContent: string;
  rationale: string;
  budget: SkillEvolutionPatchBudget;
  metadata?: Record<string, unknown>;
}

export interface SkillPatchScore {
  baselineScore: number;
  candidateScore: number;
}

export interface ProposePatchInput {
  nodeId: string;
  project?: string;
  beforeContent: string;
  title: string;
}

export interface ScoreCandidateInput {
  nodeId: string;
  project?: string;
  beforeContent: string;
  afterContent: string;
}

export type SkillEvolutionOptimizerOutcome =
  | 'accepted'
  | 'gate_rejected'
  | 'budget_rejected'
  | 'no_proposal'
  | 'suppressed_known_rejection'
  | 'missing_node';

export interface SkillEvolutionOptimizationResult {
  nodeId: string;
  outcome: SkillEvolutionOptimizerOutcome;
  patchId?: string;
  evaluationId?: string;
}

export interface SkillEvolutionOptimizerDeps {
  evolutionStore: SkillEvolutionStore;
  graphStore: ContextGraphStore;
  gate: SkillEvolutionGate;
  proposePatch: (input: ProposePatchInput) => Promise<SkillPatchProposal | null>;
  scoreCandidate: (input: ScoreCandidateInput) => Promise<SkillPatchScore>;
  evaluator?: SkillEvolutionEvaluator;
  metric?: SkillEvolutionMetric;
}

export interface OptimizeNodeOptions {
  nodeId: string;
}

/**
 * SkillOpt-style optimizer loop. The optimizer never writes graph nodes
 * directly: it proposes a bounded text patch, validates it against the
 * budget, persists it as a candidate, and lets the evaluation gate decide
 * acceptance. A rejected-edit buffer (deterministic patch fingerprint of
 * previously rejected `sourceNodeId + afterContent`) suppresses repeated
 * proposals that already failed the gate so the loop cannot thrash on the
 * same bad edit.
 */
export class SkillEvolutionOptimizer {
  constructor(private readonly deps: SkillEvolutionOptimizerDeps) {}

  async optimizeNode(options: OptimizeNodeOptions): Promise<SkillEvolutionOptimizationResult> {
    const node = this.deps.graphStore.getNodeById(options.nodeId);
    if (!node) {
      return { nodeId: options.nodeId, outcome: 'missing_node' };
    }

    const proposal = await this.deps.proposePatch({
      nodeId: node.id,
      project: node.project,
      beforeContent: node.content,
      title: node.title,
    });
    if (!proposal || !isValidProposal(proposal)) {
      return { nodeId: node.id, outcome: 'no_proposal' };
    }

    if (this.isKnownRejection(node.id, proposal.afterContent)) {
      return { nodeId: node.id, outcome: 'suppressed_known_rejection' };
    }

    const budget = validateSkillEvolutionPatchBudget({
      sourceNode: node,
      operation: proposal.operation,
      beforeContent: node.content,
      afterContent: proposal.afterContent,
      budget: proposal.budget,
    });
    if (!budget.valid) {
      return { nodeId: node.id, outcome: 'budget_rejected' };
    }

    const patch = this.deps.evolutionStore.createPatch({
      project: node.project,
      sourceNodeId: node.id,
      operation: proposal.operation,
      beforeContent: node.content,
      afterContent: proposal.afterContent,
      rationale: proposal.rationale,
      budget: proposal.budget,
      metadata: {
        ...(proposal.metadata ?? {}),
        proposedBy: 'skill-evolution-optimizer',
        rejectionFingerprint: rejectionFingerprint(node.id, proposal.afterContent),
      },
    });

    const score = await this.deps.scoreCandidate({
      nodeId: node.id,
      project: node.project,
      beforeContent: node.content,
      afterContent: proposal.afterContent,
    });

    const evaluation = this.deps.gate.evaluateScoreGate({
      patchId: patch.id,
      evaluator: this.deps.evaluator ?? ('retrieval' as SkillEvolutionEvaluator),
      metric: this.deps.metric ?? ('f1' as SkillEvolutionMetric),
      baselineScore: score.baselineScore,
      candidateScore: score.candidateScore,
      details: { proposedBy: 'skill-evolution-optimizer' },
    });

    return {
      nodeId: node.id,
      outcome: evaluation.accepted ? 'accepted' : 'gate_rejected',
      patchId: patch.id,
      evaluationId: evaluation.id,
    };
  }

  /**
   * Optimize a batch of targets (e.g. from
   * `collectSkillOptimizationTargets`). Each target is optimized
   * independently; failures on one target do not abort the rest.
   */
  async optimizeTargets(targets: ReadonlyArray<{ nodeId: string }>): Promise<SkillEvolutionOptimizationResult[]> {
    const results: SkillEvolutionOptimizationResult[] = [];
    for (const target of targets) {
      results.push(await this.optimizeNode({ nodeId: target.nodeId }));
    }
    return results;
  }

  private isKnownRejection(nodeId: string, afterContent: string): boolean {
    const fingerprint = rejectionFingerprint(nodeId, afterContent);
    return this.deps.evolutionStore
      .listPatches({ sourceNodeId: nodeId, status: SkillEvolutionPatchStatus.REJECTED, limit: 200 })
      .some((patch: SkillEvolutionPatch) => patch.metadata?.['rejectionFingerprint'] === fingerprint);
  }
}

const isValidProposal = (proposal: SkillPatchProposal): boolean =>
  typeof proposal.afterContent === 'string' &&
  proposal.afterContent.trim().length > 0 &&
  typeof proposal.rationale === 'string' &&
  proposal.rationale.trim().length > 0 &&
  typeof proposal.budget?.maxChangedBullets === 'number' &&
  typeof proposal.budget?.maxChangedTokens === 'number';

const rejectionFingerprint = (nodeId: string, afterContent: string): string =>
  createHash('sha256').update(`${nodeId}\u0000${afterContent.trim()}`).digest('hex');
