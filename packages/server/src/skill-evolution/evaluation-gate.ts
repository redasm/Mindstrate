import {
  ContextNodeStatus,
  type SkillEvolutionEvaluation,
  type SkillEvolutionEvaluator,
  type SkillEvolutionMetric,
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

export class SkillEvolutionGate {
  constructor(
    private readonly evolutionStore: SkillEvolutionStore,
    private readonly graphStore: ContextGraphStore,
  ) {}

  evaluateScoreGate(input: EvaluateSkillEvolutionScoreGateInput): SkillEvolutionEvaluation {
    const patch = this.evolutionStore.getPatchById(input.patchId);
    if (!patch) {
      throw new Error(`Skill evolution patch not found: ${input.patchId}`);
    }

    const sourceNode = this.graphStore.getNodeById(patch.sourceNodeId);
    const budget = validateSkillEvolutionPatchBudget({
      sourceNode,
      operation: patch.operation,
      beforeContent: patch.beforeContent,
      afterContent: patch.afterContent,
      budget: patch.budget,
    });
    const accepted = budget.valid && input.candidateScore > input.baselineScore;
    const evaluation = this.evolutionStore.createEvaluation({
      patchId: patch.id,
      project: patch.project,
      evaluator: input.evaluator,
      metric: input.metric,
      baselineScore: input.baselineScore,
      candidateScore: input.candidateScore,
      accepted,
      details: {
        ...(typeof input.details === 'object' && input.details !== null ? input.details : { details: input.details }),
        budget,
      },
    });

    if (accepted) {
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

    this.evolutionStore.markPatchRejected(
      patch.id,
      budget.valid ? 'candidate_did_not_improve' : budget.reason ?? 'invalid_patch',
      { evaluationId: evaluation.id },
    );
    return evaluation;
  }
}
