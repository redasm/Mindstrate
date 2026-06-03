import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  SkillEvolutionPatchOperation,
  SkillEvolutionPatchStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SkillEvolutionGate } from '../src/skill-evolution/evaluation-gate.js';
import { SkillEvolutionStore } from '../src/skill-evolution/skill-evolution-store.js';

describe('SkillEvolutionGate', () => {
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

  it('accepts improving candidate patches and updates the source node content', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Skill',
      content: 'Use broad guidance.',
      status: ContextNodeStatus.ACTIVE,
    });
    const patch = evolutionStore.createPatch({
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: node.content,
      afterContent: 'Use validated guidance with evidence ids.',
      rationale: 'Improve validated behavior.',
      budget: { maxChangedBullets: 2, maxChangedTokens: 8 },
    });

    const result = gate.evaluateScoreGate({
      patchId: patch.id,
      evaluator: SkillEvolutionEvaluator.RETRIEVAL,
      metric: SkillEvolutionMetric.F1,
      baselineScore: 0.5,
      candidateScore: 0.7,
      details: { source: 'test' },
    });

    expect(result.accepted).toBe(true);
    expect(result.delta).toBeCloseTo(0.2);
    expect(evolutionStore.getPatchById(patch.id)?.status).toBe(SkillEvolutionPatchStatus.ACCEPTED);
    expect(graphStore.getNodeById(node.id)?.content).toBe('Use validated guidance with evidence ids.');
  });

  it('rejects non-improving candidate patches without changing the source node', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Skill',
      content: 'Use broad guidance.',
      status: ContextNodeStatus.ACTIVE,
    });
    const patch = evolutionStore.createPatch({
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: node.content,
      afterContent: 'Use different broad guidance.',
      rationale: 'Try a change.',
      budget: { maxChangedBullets: 2, maxChangedTokens: 8 },
    });

    const result = gate.evaluateScoreGate({
      patchId: patch.id,
      evaluator: SkillEvolutionEvaluator.RETRIEVAL,
      metric: SkillEvolutionMetric.F1,
      baselineScore: 0.7,
      candidateScore: 0.7,
      details: { source: 'test' },
    });

    expect(result.accepted).toBe(false);
    expect(evolutionStore.getPatchById(patch.id)?.status).toBe(SkillEvolutionPatchStatus.REJECTED);
    expect(graphStore.getNodeById(node.id)?.content).toBe('Use broad guidance.');
  });

  it('does not auto-accept when the evaluator reports no eval cases (insufficient_data)', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Skill',
      content: 'Use broad guidance.',
      status: ContextNodeStatus.CANDIDATE,
    });
    const patch = evolutionStore.createPatch({
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: node.content,
      afterContent: 'Use validated guidance with evidence ids.',
      rationale: 'Improve validated behavior.',
      budget: { maxChangedBullets: 2, maxChangedTokens: 8 },
    });

    const result = gate.evaluateWithEvaluator(
      {
        patchId: patch.id,
        evaluator: SkillEvolutionEvaluator.RETRIEVAL,
        metric: SkillEvolutionMetric.F1,
      },
      () => ({ totalCases: 0, baselineScore: 0, candidateScore: 0 }),
    );

    expect(result.accepted).toBe(false);
    expect(result.status).toBe('insufficient_data');
    // candidate stays candidate — neither accepted nor rejected — so a
    // human / later run with eval data can still decide.
    expect(evolutionStore.getPatchById(patch.id)?.status).toBe(SkillEvolutionPatchStatus.CANDIDATE);
    expect(graphStore.getNodeById(node.id)?.content).toBe('Use broad guidance.');
  });

  it('auto-accepts through the evaluator when eval cases show improvement', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Skill',
      content: 'Use broad guidance.',
      status: ContextNodeStatus.CANDIDATE,
    });
    const patch = evolutionStore.createPatch({
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: node.content,
      afterContent: 'Use validated guidance with evidence ids.',
      rationale: 'Improve validated behavior.',
      budget: { maxChangedBullets: 2, maxChangedTokens: 8 },
    });

    const result = gate.evaluateWithEvaluator(
      {
        patchId: patch.id,
        evaluator: SkillEvolutionEvaluator.RETRIEVAL,
        metric: SkillEvolutionMetric.F1,
      },
      () => ({ totalCases: 3, baselineScore: 0.4, candidateScore: 0.65 }),
    );

    expect(result.accepted).toBe(true);
    expect(result.status).toBe('accepted');
    expect(evolutionStore.getPatchById(patch.id)?.status).toBe(SkillEvolutionPatchStatus.ACCEPTED);
    expect(graphStore.getNodeById(node.id)?.content).toBe('Use validated guidance with evidence ids.');
  });
});
