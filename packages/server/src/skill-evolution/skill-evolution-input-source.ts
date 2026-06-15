import {
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { FeedbackLoop } from '../quality/feedback-loop.js';

const HIGH_ORDER_SUBSTRATES: readonly SubstrateType[] = [
  SubstrateType.SKILL,
  SubstrateType.RULE,
  SubstrateType.HEURISTIC,
  SubstrateType.AXIOM,
];

export type SkillOptimizationReason = 'low_adoption' | 'negative_feedback';

export interface SkillOptimizationTarget {
  nodeId: string;
  substrateType: SubstrateType;
  reason: SkillOptimizationReason;
}

export interface SkillOptimizationInputDeps {
  graphStore: ContextGraphStore;
  feedbackLoop: FeedbackLoop;
}

export interface CollectSkillOptimizationTargetsOptions {
  project?: string;
  /** Minimum (negative - positive) feedback delta to flag a node. Defaults to 2. */
  minNegativeFeedbackDelta?: number;
  limit?: number;
}

/**
 * Build the SkillOpt-style optimizer input set from real failure signals:
 *
 *   - `low_adoption`: nodes the feedback loop flags as low-adoption
 *     (>=5 retrievals, <30% adoption) — the closest analogue to SkillOpt's
 *     "failed eval cases" within Mindstrate's online feedback.
 *   - `negative_feedback`: active high-order nodes whose negative feedback
 *     materially exceeds positive feedback.
 *
 * Only active SKILL / RULE / HEURISTIC / AXIOM nodes are returned —
 * candidates are gated separately, and low-order substrate is not a skill
 * the optimizer should rewrite.
 */
export const collectSkillOptimizationTargets = (
  deps: SkillOptimizationInputDeps,
  options: CollectSkillOptimizationTargetsOptions = {},
): SkillOptimizationTarget[] => {
  const minDelta = options.minNegativeFeedbackDelta ?? 2;
  const lowAdoption = new Set(deps.feedbackLoop.getGlobalStats().lowAdoptionNodes);

  const nodes = HIGH_ORDER_SUBSTRATES.flatMap((substrateType) =>
    deps.graphStore.listNodes({
      project: options.project,
      substrateType,
      status: ContextNodeStatus.ACTIVE,
      limit: options.limit ?? 200,
    }),
  );

  const targets: SkillOptimizationTarget[] = [];
  for (const node of nodes) {
    const reason = classify(node, lowAdoption, minDelta);
    if (reason) targets.push({ nodeId: node.id, substrateType: node.substrateType, reason });
  }
  return targets;
};

const classify = (
  node: ContextNode,
  lowAdoption: Set<string>,
  minDelta: number,
): SkillOptimizationReason | null => {
  if (lowAdoption.has(node.id)) return 'low_adoption';
  if (node.negativeFeedback - node.positiveFeedback >= minDelta) return 'negative_feedback';
  return null;
};
