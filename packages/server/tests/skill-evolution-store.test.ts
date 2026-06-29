import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SkillEvolutionPatchOperation,
  SkillEvolutionPatchStatus,
  SkillEvolutionEvaluator,
  SkillEvolutionGateStatus,
  SkillEvolutionMetric,
} from '@mindstrate/protocol/models';
import { SkillEvolutionStore } from '../src/skill-evolution/skill-evolution-store.js';

describe('SkillEvolutionStore', () => {
  let db: Database.Database;
  let store: SkillEvolutionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SkillEvolutionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates candidate patches and lists them newest first', () => {
    const first = store.createPatch({
      project: 'mindstrate',
      sourceNodeId: 'node-1',
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Use broad guidance.',
      afterContent: 'Use validated, evidence-backed guidance.',
      rationale: 'Tighten skill instruction from feedback.',
      budget: { maxChangedBullets: 2, maxChangedTokens: 20 },
    });
    const second = store.createPatch({
      project: 'mindstrate',
      sourceNodeId: 'node-2',
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: '- Existing rule',
      afterContent: '- Existing rule\n- New bounded rule',
      rationale: 'Add missing bounded guidance.',
      budget: { maxChangedBullets: 1, maxChangedTokens: 10 },
    });

    expect(first.status).toBe(SkillEvolutionPatchStatus.CANDIDATE);
    expect(store.getPatchById(first.id)?.afterContent).toBe('Use validated, evidence-backed guidance.');
    expect(store.listPatches({ project: 'mindstrate' }).map((patch) => patch.id)).toEqual([second.id, first.id]);
  });

  it('marks patches accepted and rejected with decision metadata', () => {
    const patch = store.createPatch({
      sourceNodeId: 'node-1',
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Before',
      afterContent: 'After',
      rationale: 'Improve it',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });

    const accepted = store.markPatchAccepted(patch.id, { evaluationId: 'eval-1' });
    expect(accepted?.status).toBe(SkillEvolutionPatchStatus.ACCEPTED);
    expect(accepted?.metadata?.['evaluationId']).toBe('eval-1');

    const rejectedPatch = store.createPatch({
      sourceNodeId: 'node-2',
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Before',
      afterContent: 'After',
      rationale: 'Improve it',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });
    const rejected = store.markPatchRejected(rejectedPatch.id, 'candidate_did_not_improve', { evaluationId: 'eval-2' });

    expect(rejected?.status).toBe(SkillEvolutionPatchStatus.REJECTED);
    expect(rejected?.metadata?.['rejectionReason']).toBe('candidate_did_not_improve');
  });

  it('deletes only patches whose source node no longer exists, cascading evaluations', () => {
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE context_nodes (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO context_nodes (id) VALUES (?)').run('node-live');

    const live = store.createPatch({
      project: 'mindstrate',
      sourceNodeId: 'node-live',
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Before',
      afterContent: 'After',
      rationale: 'Real candidate for an existing node.',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });
    const orphan = store.createPatch({
      project: 'mindstrate',
      sourceNodeId: 'node-gone',
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: '',
      afterContent: 'Generalized skill from 4 related rule nodes.',
      rationale: 'Orphan left by a full re-scan.',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });
    store.createEvaluation({
      patchId: orphan.id,
      evaluator: SkillEvolutionEvaluator.RETRIEVAL,
      metric: SkillEvolutionMetric.F1,
      baselineScore: 0,
      candidateScore: 0,
      accepted: false,
      status: SkillEvolutionGateStatus.REJECTED,
    });

    const result = store.deleteOrphanedPatches({ project: 'mindstrate' });

    expect(result.patchesDeleted).toBe(1);
    expect(store.getPatchById(orphan.id)).toBeNull();
    expect(store.getPatchById(live.id)).not.toBeNull();
    expect(store.listEvaluations(orphan.id)).toHaveLength(0);
  });

  it('records evaluations against patches', () => {
    const patch = store.createPatch({
      sourceNodeId: 'node-1',
      operation: SkillEvolutionPatchOperation.REPLACE,
      beforeContent: 'Before',
      afterContent: 'After',
      rationale: 'Improve it',
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });

    const evaluation = store.createEvaluation({
      patchId: patch.id,
      evaluator: SkillEvolutionEvaluator.RETRIEVAL,
      metric: SkillEvolutionMetric.F1,
      baselineScore: 0.4,
      candidateScore: 0.6,
      accepted: true,
      status: SkillEvolutionGateStatus.ACCEPTED,
      details: { cases: 3 },
    });

    expect(evaluation.delta).toBeCloseTo(0.2);
    expect(evaluation.status).toBe(SkillEvolutionGateStatus.ACCEPTED);
    expect(store.listEvaluations(patch.id)).toHaveLength(1);
    expect(store.listEvaluations(patch.id)[0].details).toEqual({ cases: 3 });
  });
});
