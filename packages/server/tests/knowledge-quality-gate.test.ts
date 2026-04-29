/**
 * Tests for the write-time knowledge quality gate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KnowledgeType } from '@mindstrate/protocol';
import { KnowledgeQualityGate } from '../src/processing/knowledge-quality-gate.js';
import { makeKnowledgeInput } from './test-support.js';

describe('KnowledgeQualityGate', () => {
  let qualityGate: KnowledgeQualityGate;

  beforeEach(() => {
    qualityGate = new KnowledgeQualityGate();
  });

  it('passes well-formed input', () => {
    const result = qualityGate.check(makeKnowledgeInput());
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.completenessScore).toBeGreaterThan(50);
  });

  it('fails when title is missing', () => {
    const result = qualityGate.check(makeKnowledgeInput({ title: '' }));
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Title is required and cannot be empty');
  });

  it('fails when solution is missing', () => {
    const result = qualityGate.check(makeKnowledgeInput({ solution: '' }));
    expect(result.passed).toBe(false);
    expect(result.errors).toContain('Solution is required and cannot be empty');
  });

  it('fails when type is missing', () => {
    const result = qualityGate.check(makeKnowledgeInput({ type: undefined }));
    expect(result.passed).toBe(false);
  });

  it('warns for bug fixes without problem descriptions', () => {
    const result = qualityGate.check(makeKnowledgeInput({ problem: undefined }));
    expect(result.passed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('problem description'))).toBe(true);
  });

  it('warns when no tags are provided', () => {
    const result = qualityGate.check(makeKnowledgeInput({ tags: [] }));
    expect(result.passed).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('tags'))).toBe(true);
  });

  it('scores actionable guidance above plain input', () => {
    const plainScore = qualityGate.check(makeKnowledgeInput()).completenessScore;
    const guidedScore = qualityGate.check(makeKnowledgeInput({
      actionable: {
        preconditions: ['Node >= 18'],
        steps: ['Step 1', 'Step 2'],
        verification: 'Run npm test',
      },
    })).completenessScore;

    expect(guidedScore).toBeGreaterThan(plainScore);
  });

  it('warns for workflow knowledge without steps', () => {
    const result = qualityGate.check(makeKnowledgeInput({ type: KnowledgeType.WORKFLOW }));
    expect(result.warnings.some((warning) => warning.includes('actionable steps'))).toBe(true);
  });
});
