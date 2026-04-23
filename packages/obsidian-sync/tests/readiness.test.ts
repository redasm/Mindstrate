import { describe, it, expect } from 'vitest';
import { KnowledgeType } from '@mindstrate/server';
import {
  assessCanonicalSourceReadiness,
  type CanonicalSourceAssessmentInput,
} from '../src/readiness.js';

function makeInput(overrides: Partial<CanonicalSourceAssessmentInput> = {}): CanonicalSourceAssessmentInput {
  return {
    totalKnowledge: 10,
    indexedEntries: 10,
    markdownFiles: 10,
    editableKnowledge: 6,
    mirrorKnowledge: 4,
    hasMirrorProtection: true,
    hasStaleEditProtection: true,
    hasVersionedMerge: false,
    hasTeamConflictResolution: false,
    ...overrides,
  };
}

describe('canonical source readiness assessment', () => {
  it('returns not_ready when vault and Mindstrate are already drifting', () => {
    const report = assessCanonicalSourceReadiness(makeInput({
      totalKnowledge: 12,
      indexedEntries: 10,
      markdownFiles: 9,
    }));

    expect(report.level).toBe('not_ready');
    expect(report.blockers.some((b) => b.includes('drift'))).toBe(true);
  });

  it('returns pilot_only when safety guards exist but multi-writer governance is missing', () => {
    const report = assessCanonicalSourceReadiness(makeInput());

    expect(report.level).toBe('pilot_only');
    expect(report.strengths.some((s) => s.includes('Mirror-only'))).toBe(true);
    expect(report.blockers.some((b) => b.includes('team conflict'))).toBe(true);
  });

  it('returns ready only when governance gaps are closed', () => {
    const report = assessCanonicalSourceReadiness(makeInput({
      hasVersionedMerge: true,
      hasTeamConflictResolution: true,
    }));

    expect(report.level).toBe('ready');
    expect(report.blockers).toHaveLength(0);
  });

  it('counts editable and mirror types consistently with current sync policy', () => {
    const report = assessCanonicalSourceReadiness(makeInput({
      editableKnowledge: 3,
      mirrorKnowledge: 2,
    }));

    expect(report.summary.editableKnowledge).toBe(3);
    expect(report.summary.mirrorKnowledge).toBe(2);
    expect(report.recommendation).toContain('pilot');
    expect(KnowledgeType.ARCHITECTURE).toBe('architecture');
  });
});
