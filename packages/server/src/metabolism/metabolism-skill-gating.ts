import {
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { SkillEvolutionGate, SkillEvolutionEvaluatorResult } from '../skill-evolution/evaluation-gate.js';
import { SkillEvolutionEvaluator, SkillEvolutionMetric, SkillEvolutionPatchOperation } from '@mindstrate/protocol/models';
import type { SkillEvolutionStore } from '../skill-evolution/skill-evolution-store.js';

const HIGH_ORDER_SUBSTRATES: readonly SubstrateType[] = [
  SubstrateType.SKILL,
  SubstrateType.HEURISTIC,
  SubstrateType.AXIOM,
];

export interface SkillGatingResult {
  gated: number;
  accepted: number;
  rejected: number;
  insufficientData: number;
}

export interface SkillGatingDeps {
  graphStore: ContextGraphStore;
  skillEvolutionStore: SkillEvolutionStore;
  skillEvolutionGate: SkillEvolutionGate;
  /**
   * Supplies the validation scores for a candidate high-order node. The
   * metabolism loop has no built-in eval harness, so the default returns
   * zero cases (`insufficient_data`) and the candidate is never
   * auto-promoted without evidence. Callers that wire a real evaluator
   * (RetrievalEvaluator over held-out cases) override this.
   */
  runEvaluator?: (node: ContextNode) => SkillEvolutionEvaluatorResult;
}

/**
 * Gate freshly-created candidate high-order nodes (SKILL / HEURISTIC /
 * AXIOM) through the SkillOpt-style validation gate. Each candidate is
 * registered as an `add` patch (before = empty, after = node content) so
 * the decision is auditable, then the gate decides promotion. Without
 * eval data the gate returns `insufficient_data` and the node stays a
 * candidate — metabolism never silently promotes a clustering guess to
 * active high-order knowledge.
 */
export const gateCandidateHighOrderNodes = (
  deps: SkillGatingDeps,
  project: string | undefined,
): SkillGatingResult => {
  const result: SkillGatingResult = { gated: 0, accepted: 0, rejected: 0, insufficientData: 0 };

  const candidates = HIGH_ORDER_SUBSTRATES.flatMap((substrateType) =>
    deps.graphStore.listNodes({
      project,
      substrateType,
      status: ContextNodeStatus.CANDIDATE,
      limit: 200,
    }),
  );

  for (const node of candidates) {
    if (hasGatingPatch(deps.skillEvolutionStore, node.id)) continue;

    const patch = deps.skillEvolutionStore.createPatch({
      project: node.project,
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: '',
      afterContent: node.content,
      rationale: `Metabolism candidate-first promotion gate for ${node.substrateType} ${node.id}.`,
      budget: { maxChangedBullets: Number.MAX_SAFE_INTEGER, maxChangedTokens: Number.MAX_SAFE_INTEGER },
      metadata: { gatedBy: 'metabolism.skill-gating' },
    });

    const evaluation = deps.skillEvolutionGate.evaluateWithEvaluator(
      {
        patchId: patch.id,
        evaluator: SkillEvolutionEvaluator.RETRIEVAL,
        metric: SkillEvolutionMetric.F1,
        details: { gatedBy: 'metabolism.skill-gating' },
      },
      () => (deps.runEvaluator?.(node) ?? { totalCases: 0, baselineScore: 0, candidateScore: 0 }),
    );

    result.gated++;
    if (evaluation.status === 'accepted') result.accepted++;
    else if (evaluation.status === 'rejected') result.rejected++;
    else result.insufficientData++;
  }

  return result;
};

const hasGatingPatch = (store: SkillEvolutionStore, nodeId: string): boolean =>
  store.listPatches({ sourceNodeId: nodeId, limit: 50 })
    .some((patch) => patch.metadata?.['gatedBy'] === 'metabolism.skill-gating');
