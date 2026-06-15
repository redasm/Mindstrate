import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SkillEvolutionPatchOperation,
  SkillEvolutionPatchStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SkillEvolutionGate } from '../src/skill-evolution/evaluation-gate.js';
import { SkillEvolutionOptimizer } from '../src/skill-evolution/skill-evolution-optimizer.js';
import { SkillEvolutionStore } from '../src/skill-evolution/skill-evolution-store.js';

describe('SkillEvolutionOptimizer', () => {
  let db: Database.Database;
  let graphStore: ContextGraphStore;
  let evolutionStore: SkillEvolutionStore;
  let gate: SkillEvolutionGate;

  beforeEach(() => {
    db = new Database(':memory:');
    graphStore = new ContextGraphStore(db);
    evolutionStore = new SkillEvolutionStore(db);
    gate = new SkillEvolutionGate(evolutionStore, graphStore);
  });

  afterEach(() => {
    db.close();
  });

  const makeSkill = () => graphStore.createNode({
    substrateType: SubstrateType.SKILL,
    domainType: ContextDomainType.WORKFLOW,
    title: 'Skill',
    content: '- Use broad guidance',
    project: 'mindstrate',
    status: ContextNodeStatus.ACTIVE,
  });

  it('turns a valid proposal into a gated, accepted patch', async () => {
    const skill = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => ({
        operation: SkillEvolutionPatchOperation.ADD,
        afterContent: '- Use broad guidance\n- Record evaluation evidence ids',
        rationale: 'Add bounded evidence guidance.',
        budget: { maxChangedBullets: 1, maxChangedTokens: 6 },
      }),
      scoreCandidate: async () => ({ totalCases: 5, baselineScore: 0.4, candidateScore: 0.65 }),
    });

    const result = await optimizer.optimizeNode({ nodeId: skill.id });

    expect(result.outcome).toBe('accepted');
    expect(result.patchId).toBeDefined();
    expect(evolutionStore.getPatchById(result.patchId!)?.status).toBe(SkillEvolutionPatchStatus.ACCEPTED);
    expect(graphStore.getNodeById(skill.id)?.content).toContain('Record evaluation evidence ids');
  });

  it('rejects malformed proposals without creating a patch', async () => {
    const skill = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => null,
      scoreCandidate: async () => ({ totalCases: 5, baselineScore: 0.4, candidateScore: 0.9 }),
    });

    const result = await optimizer.optimizeNode({ nodeId: skill.id });

    expect(result.outcome).toBe('no_proposal');
    expect(result.patchId).toBeUndefined();
    expect(evolutionStore.listPatches({ sourceNodeId: skill.id })).toHaveLength(0);
  });

  it('rejects oversized proposals through the budget validator', async () => {
    const skill = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => ({
        operation: SkillEvolutionPatchOperation.REPLACE,
        afterContent: '- Completely rewritten guidance with far too many brand new tokens added here',
        rationale: 'Rewrite everything.',
        budget: { maxChangedBullets: 1, maxChangedTokens: 3 },
      }),
      scoreCandidate: async () => ({ totalCases: 5, baselineScore: 0.4, candidateScore: 0.9 }),
    });

    const result = await optimizer.optimizeNode({ nodeId: skill.id });

    expect(result.outcome).toBe('budget_rejected');
    expect(result.patchId).toBeUndefined();
    expect(graphStore.getNodeById(skill.id)?.content).toBe('- Use broad guidance');
  });

  it('suppresses repeated proposals that previously failed the gate', async () => {
    const skill = makeSkill();
    let proposalCount = 0;
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => {
        proposalCount++;
        return {
          operation: SkillEvolutionPatchOperation.REPLACE,
          afterContent: '- Use slightly different guidance',
          rationale: 'Try the same non-improving change.',
          budget: { maxChangedBullets: 2, maxChangedTokens: 8 },
        };
      },
      scoreCandidate: async () => ({ totalCases: 5, baselineScore: 0.6, candidateScore: 0.6 }),
    });

    const first = await optimizer.optimizeNode({ nodeId: skill.id });
    expect(first.outcome).toBe('gate_rejected');

    const second = await optimizer.optimizeNode({ nodeId: skill.id });
    expect(second.outcome).toBe('suppressed_known_rejection');
    expect(proposalCount).toBe(2);
    expect(
      evolutionStore.listPatches({ sourceNodeId: skill.id, status: SkillEvolutionPatchStatus.REJECTED }),
    ).toHaveLength(1);
  });

  it('optimizes a batch of collected targets independently', async () => {
    const a = makeSkill();
    const b = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async (input) => ({
        operation: SkillEvolutionPatchOperation.ADD,
        afterContent: `${input.beforeContent}\n- Record evaluation evidence ids`,
        rationale: 'Add bounded evidence guidance.',
        budget: { maxChangedBullets: 1, maxChangedTokens: 6 },
      }),
      scoreCandidate: async () => ({ totalCases: 5, baselineScore: 0.4, candidateScore: 0.65 }),
    });

    const results = await optimizer.optimizeTargets([{ nodeId: a.id }, { nodeId: b.id }]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === 'accepted')).toBe(true);
  });

  it('parks the patch as insufficient_data when the scorer has no eval cases', async () => {
    const skill = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => ({
        operation: SkillEvolutionPatchOperation.ADD,
        afterContent: '- Use broad guidance\n- Record evaluation evidence ids',
        rationale: 'Add bounded evidence guidance.',
        budget: { maxChangedBullets: 1, maxChangedTokens: 6 },
      }),
      scoreCandidate: async () => ({ totalCases: 0, baselineScore: 0, candidateScore: 0 }),
    });

    const result = await optimizer.optimizeNode({ nodeId: skill.id });

    expect(result.outcome).toBe('insufficient_data');
    expect(result.patchId).toBeDefined();
    // patch stays a reviewable candidate — neither applied nor rejected
    expect(evolutionStore.getPatchById(result.patchId!)?.status).toBe(SkillEvolutionPatchStatus.CANDIDATE);
    expect(graphStore.getNodeById(skill.id)?.content).toBe('- Use broad guidance');
  });

  it('suppresses identical proposals while a candidate patch is still pending review', async () => {
    const skill = makeSkill();
    const optimizer = new SkillEvolutionOptimizer({
      evolutionStore,
      graphStore,
      gate,
      proposePatch: async () => ({
        operation: SkillEvolutionPatchOperation.ADD,
        afterContent: '- Use broad guidance\n- Record evaluation evidence ids',
        rationale: 'Add bounded evidence guidance.',
        budget: { maxChangedBullets: 1, maxChangedTokens: 6 },
      }),
      scoreCandidate: async () => ({ totalCases: 0, baselineScore: 0, candidateScore: 0 }),
    });

    const first = await optimizer.optimizeNode({ nodeId: skill.id });
    expect(first.outcome).toBe('insufficient_data');

    const second = await optimizer.optimizeNode({ nodeId: skill.id });
    expect(second.outcome).toBe('suppressed_pending_candidate');
    expect(evolutionStore.listPatches({ sourceNodeId: skill.id })).toHaveLength(1);
  });
});
