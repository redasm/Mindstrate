import {
  ContextNodeStatus,
  SkillEvolutionGateStatus,
  type SkillEvolutionEvaluation,
  type SkillEvolutionEvaluator,
  type SkillEvolutionMetric,
  type SkillEvolutionPatch,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { validateSkillEvolutionPatchBudget } from './patch-budget.js';
import type { SkillEvolutionStore } from './skill-evolution-store.js';

export interface EvaluateSkillEvolutionScoreGateInput {
  patchId: string;
  evaluator: SkillEvolutionEvaluator;
  metric: SkillEvolutionMetric;
  baselineScore: number;
  candidateScore: number;
  details?: unknown;
}

export interface EvaluateSkillEvolutionWithEvaluatorInput {
  patchId: string;
  evaluator: SkillEvolutionEvaluator;
  metric: SkillEvolutionMetric;
  details?: unknown;
}

export interface SkillEvolutionEvaluatorResult {
  totalCases: number;
  baselineScore: number;
  candidateScore: number;
}

export class SkillEvolutionGate {
  constructor(
    private readonly evolutionStore: SkillEvolutionStore,
    private readonly graphStore: ContextGraphStore,
  ) {}

  /**
   * Hard gate on caller-supplied scores. Accepts only when the budget is
   * valid AND `candidateScore > baselineScore`.
   */
  evaluateScoreGate(input: EvaluateSkillEvolutionScoreGateInput): SkillEvolutionEvaluation {
    const patch = this.requirePatch(input.patchId);
    const status = this.decideStatus(patch, input.baselineScore, input.candidateScore, true);
    return this.recordAndApply(patch, {
      evaluator: input.evaluator,
      metric: input.metric,
      baselineScore: input.baselineScore,
      candidateScore: input.candidateScore,
      status,
      details: input.details,
    });
  }

  /**
   * Validation-gated update à la SkillOpt: run the supplied evaluator
   * (e.g. a RetrievalEvaluator over the held-out eval cases). When the
   * evaluator reports zero cases the gate returns `insufficient_data`
   * and leaves the patch as a candidate — it is NEVER auto-accepted or
   * auto-rejected without evidence, so a later run (or a human) can still
   * decide once eval data exists.
   */
  evaluateWithEvaluator(
    input: EvaluateSkillEvolutionWithEvaluatorInput,
    runEvaluator: () => SkillEvolutionEvaluatorResult,
  ): SkillEvolutionEvaluation {
    const patch = this.requirePatch(input.patchId);
    const result = runEvaluator();
    const hasData = result.totalCases > 0;
    const status = hasData
      ? this.decideStatus(patch, result.baselineScore, result.candidateScore, true)
      : SkillEvolutionGateStatus.INSUFFICIENT_DATA;

    return this.recordAndApply(patch, {
      evaluator: input.evaluator,
      metric: input.metric,
      baselineScore: result.baselineScore,
      candidateScore: result.candidateScore,
      status,
      details: {
        ...(typeof input.details === 'object' && input.details !== null ? input.details : { details: input.details }),
        totalCases: result.totalCases,
      },
    });
  }

  private requirePatch(patchId: string): SkillEvolutionPatch {
    const patch = this.evolutionStore.getPatchById(patchId);
    if (!patch) throw new Error(`Skill evolution patch not found: ${patchId}`);
    return patch;
  }

  private decideStatus(
    patch: SkillEvolutionPatch,
    baselineScore: number,
    candidateScore: number,
    requireImprovement: boolean,
  ): SkillEvolutionGateStatus {
    const sourceNode = this.graphStore.getNodeById(patch.sourceNodeId);
    const budget = validateSkillEvolutionPatchBudget({
      sourceNode,
      operation: patch.operation,
      beforeContent: patch.beforeContent,
      afterContent: patch.afterContent,
      budget: patch.budget,
    });
    if (!budget.valid) return SkillEvolutionGateStatus.REJECTED;
    if (requireImprovement && candidateScore <= baselineScore) return SkillEvolutionGateStatus.REJECTED;
    return SkillEvolutionGateStatus.ACCEPTED;
  }

  private recordAndApply(
    patch: SkillEvolutionPatch,
    input: {
      evaluator: SkillEvolutionEvaluator;
      metric: SkillEvolutionMetric;
      baselineScore: number;
      candidateScore: number;
      status: SkillEvolutionGateStatus;
      details?: unknown;
    },
  ): SkillEvolutionEvaluation {
    const sourceNode = this.graphStore.getNodeById(patch.sourceNodeId);
    const budget = validateSkillEvolutionPatchBudget({
      sourceNode,
      operation: patch.operation,
      beforeContent: patch.beforeContent,
      afterContent: patch.afterContent,
      budget: patch.budget,
    });
    const evaluation = this.evolutionStore.createEvaluation({
      patchId: patch.id,
      project: patch.project,
      evaluator: input.evaluator,
      metric: input.metric,
      baselineScore: input.baselineScore,
      candidateScore: input.candidateScore,
      accepted: input.status === SkillEvolutionGateStatus.ACCEPTED,
      status: input.status,
      details: {
        ...(typeof input.details === 'object' && input.details !== null ? input.details : { details: input.details }),
        budget,
      },
    });

    if (input.status === SkillEvolutionGateStatus.ACCEPTED) {
      this.graphStore.updateNode(patch.sourceNodeId, {
        content: patch.afterContent,
        status: sourceNode?.status === ContextNodeStatus.CANDIDATE ? ContextNodeStatus.ACTIVE : sourceNode?.status,
        metadata: {
          ...(sourceNode?.metadata ?? {}),
          skillEvolution: {
            patchId: patch.id,
            evaluationId: evaluation.id,
            acceptedAt: evaluation.createdAt,
          },
        },
      });
      this.evolutionStore.markPatchAccepted(patch.id, { evaluationId: evaluation.id });
      return evaluation;
    }

    if (input.status === SkillEvolutionGateStatus.REJECTED) {
      this.evolutionStore.markPatchRejected(
        patch.id,
        budget.valid ? 'candidate_did_not_improve' : budget.reason ?? 'invalid_patch',
        { evaluationId: evaluation.id },
      );
    }

    // INSUFFICIENT_DATA: leave the patch as a candidate, record the
    // evaluation for audit, but do not mutate the source node.
    return evaluation;
  }
}
