import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RetrievalEvaluator, type EvalCaseKind } from '../src/quality/eval.js';
import { initializeEvaluationSchema } from '../src/quality/evaluation-schema.js';

describe('RetrievalEvaluator dataset authoring', () => {
  let db: Database.Database;
  let evaluator: RetrievalEvaluator;
  let retrievable: string[];

  beforeEach(() => {
    db = new Database(':memory:');
    retrievable = ['k1', 'k2'];
    evaluator = new RetrievalEvaluator(db, () => retrievable);
  });

  afterEach(() => {
    db.close();
  });

  it('tags cases with a kind and defaults to validation', () => {
    const v = evaluator.addCase('q1', ['k1']);
    const h = evaluator.addCase('q2', ['k2'], { kind: 'holdout' as EvalCaseKind });

    expect(v.kind).toBe('validation');
    expect(h.kind).toBe('holdout');
  });

  it('lists cases filtered by kind', () => {
    evaluator.addCase('q1', ['k1'], { kind: 'validation' as EvalCaseKind });
    evaluator.addCase('q2', ['k2'], { kind: 'holdout' as EvalCaseKind });

    expect(evaluator.listCases({ kind: 'validation' as EvalCaseKind })).toHaveLength(1);
    expect(evaluator.listCases({ kind: 'holdout' as EvalCaseKind })).toHaveLength(1);
    expect(evaluator.listCases()).toHaveLength(2);
  });

  it('runs evaluation scoped to a single kind', async () => {
    evaluator.addCase('q1', ['k1'], { kind: 'validation' as EvalCaseKind });
    evaluator.addCase('q2', ['k2'], { kind: 'holdout' as EvalCaseKind });

    const validationRun = await evaluator.runEvaluation(5, { kind: 'validation' as EvalCaseKind });
    expect(validationRun.totalCases).toBe(1);

    const allRun = await evaluator.runEvaluation();
    expect(allRun.totalCases).toBe(2);
  });

  it('deletes a case by id', () => {
    const c = evaluator.addCase('q1', ['k1']);
    expect(evaluator.deleteCase(c.id)).toBe(true);
    expect(evaluator.listCases()).toHaveLength(0);
  });
});

describe('initializeEvaluationSchema migration', () => {
  it('migrates a legacy eval_cases table without a kind column', () => {
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE eval_cases (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        expected_ids TEXT NOT NULL,
        language TEXT,
        framework TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacy.prepare(
      `INSERT INTO eval_cases (id, query, expected_ids, created_at) VALUES (?, ?, ?, ?)`,
    ).run('old', 'legacy query', '["k1"]', new Date().toISOString());

    expect(() => initializeEvaluationSchema(legacy)).not.toThrow();

    const columns = legacy.prepare(`PRAGMA table_info(eval_cases)`).all() as Array<{ name: string }>;
    expect(columns.some((c) => c.name === 'kind')).toBe(true);

    const row = legacy.prepare(`SELECT kind FROM eval_cases WHERE id = ?`).get('old') as { kind: string };
    expect(row.kind).toBe('validation');

    const indexes = legacy.prepare(`PRAGMA index_list(eval_cases)`).all() as Array<{ name: string }>;
    expect(indexes.some((i) => i.name === 'idx_eval_cases_kind')).toBe(true);

    legacy.close();
  });
});
