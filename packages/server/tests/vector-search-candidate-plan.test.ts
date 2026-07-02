import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createTempDir, removeTempDir } from './test-support.js';

/**
 * Regression guard for the cold-cache vector-search stall that surfaced as a
 * transient error on the first memory_search / graph_knowledge_search after a
 * large backfill (then succeeded on retry). The candidate query orders by
 * quality_score/updated_at; without a supporting index + statistics the planner
 * builds a TEMP B-TREE over the whole model set every search. These tests pin
 * both halves of the fix: the index exists, init runs ANALYZE, and at graph
 * scale the planner walks the index instead of sorting.
 *
 * The plan the planner picks is cost-based, so the sort only loses to the index
 * walk once the row count is well past the break-even point (near it, the
 * choice flips on data distribution). Production graphs are 100k+ nodes — far
 * above break-even — so the fixture seeds a decisively-large set (rows are
 * bulk-inserted through the raw handle to keep the test fast).
 */
describe('vector-search candidate ordering plan', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  const MODEL = 'text-embedding-v4';
  const ROWS = 3000;

  // The exact projection candidatesForSearch() pulls — the extra vector columns
  // matter, since selecting only node_id would let a covering index sidestep the
  // sort and mask the regression.
  const CANDIDATE_SQL = `
    SELECT ne.node_id AS node_id, ne.embedding_vec AS embedding_vec, ne.embedding AS embedding
    FROM node_embeddings ne
    JOIN context_nodes n ON n.id = ne.node_id
    WHERE ne.model = ?
    ORDER BY n.quality_score DESC, n.updated_at DESC
    LIMIT 5000
  `;
  const CANDIDATE_SQL_PROJECT = `
    SELECT ne.node_id AS node_id, ne.embedding_vec AS embedding_vec, ne.embedding AS embedding
    FROM node_embeddings ne
    JOIN context_nodes n ON n.id = ne.node_id
    WHERE ne.model = ? AND LOWER(n.project) = LOWER(?)
    ORDER BY n.quality_score DESC, n.updated_at DESC
    LIMIT 5000
  `;

  const planFor = (sql: string, params: unknown[]): string[] =>
    store.rawDatabase
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params)
      .map((row) => (row as { detail: string }).detail);

  beforeEach(() => {
    tempDir = createTempDir();
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));

    const db = store.rawDatabase;
    const insNode = db.prepare(`
      INSERT INTO context_nodes (id, substrate_type, domain_type, title, content, project, status, quality_score, created_at, updated_at)
      VALUES (?, 'snapshot', 'project_snapshot', ?, ?, 'nami_dev', 'active', ?, '2026-07-01T00:00:00Z', ?)
    `);
    const insEmb = db.prepare(`
      INSERT INTO node_embeddings (node_id, model, dimensions, embedding, embedding_vec, text, created_at, updated_at)
      VALUES (?, ?, 4, '[]', ?, 't', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')
    `);
    const blob = Buffer.alloc(16);
    db.transaction(() => {
      for (let i = 0; i < ROWS; i++) {
        const id = `n${i}`;
        insNode.run(id, `t${i}`, `c${i}`, (i * 37) % 100, `2026-07-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z`);
        insEmb.run(id, MODEL, blob);
      }
    })();
    // init ran ANALYZE on the (then empty) tables; refresh so stats reflect the
    // seeded rows the way a real graph's stats would.
    db.exec('ANALYZE context_nodes; ANALYZE node_embeddings;');
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('creates the quality-ordering index', () => {
    const idx = store.rawDatabase
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_context_nodes_quality'`,
      )
      .get();
    expect(idx).toBeTruthy();
  });

  it('records statistics for the quality index on init (ANALYZE guard ran)', () => {
    const stat = store.rawDatabase
      .prepare(`SELECT 1 FROM sqlite_stat1 WHERE idx = 'idx_context_nodes_quality'`)
      .get();
    expect(stat).toBeTruthy();
  });

  it('resolves the global candidate query without a TEMP B-TREE sort', () => {
    const plan = planFor(CANDIDATE_SQL, [MODEL]);
    expect(plan.some((d) => /TEMP B-TREE/i.test(d))).toBe(false);
    expect(plan.some((d) => d.includes('idx_context_nodes_quality'))).toBe(true);
  });

  it('resolves the project-scoped candidate query without a TEMP B-TREE sort', () => {
    const plan = planFor(CANDIDATE_SQL_PROJECT, [MODEL, 'nami_dev']);
    expect(plan.some((d) => /TEMP B-TREE/i.test(d))).toBe(false);
    expect(plan.some((d) => d.includes('idx_context_nodes_quality'))).toBe(true);
  });

  it('still returns the top candidates in quality order', () => {
    const hits = store.searchSimilarNodes({
      queryEmbedding: [0.1, 0.2, 0.3, 0.4],
      model: MODEL,
      project: 'nami_dev',
      topK: 5,
      minScore: -1,
    });
    expect(hits.length).toBe(5);
  });
});
