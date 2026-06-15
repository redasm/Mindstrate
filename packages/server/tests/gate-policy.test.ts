import { describe, expect, it } from 'vitest';
import { decideGateOutcome } from '../src/skill-evolution/gate-policy.js';

describe('decideGateOutcome', () => {
  it('hard gate accepts only on strict improvement', () => {
    expect(decideGateOutcome({ mode: 'hard' }, { baselineScore: 0.5, candidateScore: 0.6 })).toBe('accept');
    expect(decideGateOutcome({ mode: 'hard' }, { baselineScore: 0.6, candidateScore: 0.6 })).toBe('reject');
    expect(decideGateOutcome({ mode: 'hard' }, { baselineScore: 0.6, candidateScore: 0.5 })).toBe('reject');
  });

  it('soft gate accepts when partial-credit improvement clears the margin', () => {
    // default soft margin 0 → any positive delta accepts
    expect(decideGateOutcome({ mode: 'soft' }, { baselineScore: 0.5, candidateScore: 0.51 })).toBe('accept');
    expect(decideGateOutcome({ mode: 'soft', softMargin: 0.05 }, { baselineScore: 0.5, candidateScore: 0.52 })).toBe('reject');
    expect(decideGateOutcome({ mode: 'soft', softMargin: 0.05 }, { baselineScore: 0.5, candidateScore: 0.56 })).toBe('accept');
  });

  it('mixed gate blends hard and soft with the configured weight', () => {
    // hard component: candidate > baseline → 1 else 0
    // soft component: normalized delta
    // weight 1.0 → pure soft
    expect(
      decideGateOutcome(
        { mode: 'mixed', mixedWeight: 1, softMargin: 0.05 },
        { baselineScore: 0.5, candidateScore: 0.52 },
      ),
    ).toBe('reject');

    // weight 0 → pure hard, strict improvement accepts
    expect(
      decideGateOutcome(
        { mode: 'mixed', mixedWeight: 0 },
        { baselineScore: 0.5, candidateScore: 0.51 },
      ),
    ).toBe('accept');
  });

  it('never accepts when candidate is not above baseline at all', () => {
    expect(decideGateOutcome({ mode: 'soft' }, { baselineScore: 0.6, candidateScore: 0.6 })).toBe('reject');
    expect(decideGateOutcome({ mode: 'mixed' }, { baselineScore: 0.6, candidateScore: 0.59 })).toBe('reject');
  });
});
