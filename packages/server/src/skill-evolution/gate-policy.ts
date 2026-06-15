export type SkillEvolutionGateMode = 'hard' | 'soft' | 'mixed';

export interface SkillEvolutionGatePolicy {
  mode: SkillEvolutionGateMode;
  /** Minimum delta the soft component must clear. Defaults to 0. */
  softMargin?: number;
  /** Blend weight for the soft component in `mixed` mode (0..1). Defaults to 0.5. */
  mixedWeight?: number;
  /** Blended-score acceptance threshold in `mixed` mode. Defaults to 0.5. */
  mixedThreshold?: number;
}

export interface GateScores {
  baselineScore: number;
  candidateScore: number;
}

export type GateOutcome = 'accept' | 'reject';

const DEFAULT_MIXED_WEIGHT = 0.5;
const DEFAULT_MIXED_THRESHOLD = 0.5;

/**
 * Pure score-policy decision shared by the validation gate. Always
 * requires the candidate to be strictly above baseline as a hard floor —
 * no policy can accept a non-improving candidate. On top of that floor:
 *
 *   - `hard`: accept on any strict improvement.
 *   - `soft`: accept when the delta clears `softMargin` (partial credit).
 *   - `mixed`: blend a hard component (1 on strict improvement, else 0)
 *     and a soft component (1 when the delta clears `softMargin`, else 0)
 *     with `mixedWeight`, accepting when the blend reaches
 *     `mixedThreshold`.
 */
export const decideGateOutcome = (
  policy: SkillEvolutionGatePolicy,
  scores: GateScores,
): GateOutcome => {
  const delta = scores.candidateScore - scores.baselineScore;
  if (delta <= 0) return 'reject';

  const softMargin = policy.softMargin ?? 0;
  const hardComponent = delta > 0 ? 1 : 0;
  const softComponent = delta >= softMargin ? 1 : 0;

  switch (policy.mode) {
    case 'hard':
      return hardComponent === 1 ? 'accept' : 'reject';
    case 'soft':
      return softComponent === 1 ? 'accept' : 'reject';
    case 'mixed': {
      const weight = clamp01(policy.mixedWeight ?? DEFAULT_MIXED_WEIGHT);
      const threshold = policy.mixedThreshold ?? DEFAULT_MIXED_THRESHOLD;
      const blended = (1 - weight) * hardComponent + weight * softComponent;
      return blended >= threshold ? 'accept' : 'reject';
    }
  }
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
