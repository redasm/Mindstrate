import { describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SkillEvolutionPatchOperation,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import { validateSkillEvolutionPatchBudget } from '../src/skill-evolution/patch-budget.js';

describe('validateSkillEvolutionPatchBudget', () => {
  const makeNode = (substrateType: SubstrateType): ContextNode => ({
    id: 'node-1',
    substrateType,
    domainType: ContextDomainType.WORKFLOW,
    title: 'Skill node',
    content: '- Start with evidence\n- Verify the result',
    tags: [],
    compressionLevel: 0.01,
    confidence: 0.8,
    qualityScore: 80,
    status: ContextNodeStatus.ACTIVE,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessCount: 0,
    positiveFeedback: 0,
    negativeFeedback: 0,
  });

  it('allows bounded edits to high-order substrate nodes', () => {
    const result = validateSkillEvolutionPatchBudget({
      sourceNode: makeNode(SubstrateType.SKILL),
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: '- Start with evidence\n- Verify the result',
      afterContent: '- Start with evidence\n- Verify the result\n- Record the evaluation id',
      budget: { maxChangedBullets: 1, maxChangedTokens: 8 },
    });

    expect(result.valid).toBe(true);
    expect(result.changedBullets).toBe(1);
  });

  it('rejects patches for low-order substrate nodes', () => {
    const result = validateSkillEvolutionPatchBudget({
      sourceNode: makeNode(SubstrateType.SUMMARY),
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Before',
      afterContent: 'After',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported_substrate');
  });

  it('rejects oversized edits', () => {
    const result = validateSkillEvolutionPatchBudget({
      sourceNode: makeNode(SubstrateType.RULE),
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: '- A\n- B',
      afterContent: '- A changed heavily with many extra words\n- B changed heavily with many extra words\n- C added',
      budget: { maxChangedBullets: 1, maxChangedTokens: 4 },
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('budget_exceeded');
  });

  it('rejects operation/content mismatches', () => {
    const result = validateSkillEvolutionPatchBudget({
      sourceNode: makeNode(SubstrateType.SKILL),
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: '- A',
      afterContent: '- B',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('operation_content_mismatch');
  });
});
