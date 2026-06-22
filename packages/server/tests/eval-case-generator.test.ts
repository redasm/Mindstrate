import { describe, expect, it } from 'vitest';
import type { GraphKnowledgeView } from '@mindstrate/protocol';
import type { EvalCase, EvalCaseKind } from '@mindstrate/protocol/models';
import { generateEvalCasesFromKnowledge, type EvalCaseGeneratorDeps } from '../src/quality/eval-case-generator.js';

const view = (id: string, title: string, tags: string[] = []): GraphKnowledgeView => ({
  id,
  title,
  summary: title,
  content: title,
  substrateType: 'rule' as never,
  domainType: 'architecture' as never,
  project: 'demo',
  priorityScore: 1,
  status: 'active' as never,
  sourceRef: id,
  tags,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const makeDeps = (views: GraphKnowledgeView[]): { deps: EvalCaseGeneratorDeps; store: EvalCase[] } => {
  const store: EvalCase[] = [];
  const deps: EvalCaseGeneratorDeps = {
    projectKnowledge: () => views,
    listCases: (options?: { kind?: EvalCaseKind }) =>
      options?.kind ? store.filter((c) => c.kind === options.kind) : store,
    addCase: (query, expectedIds, opts) => {
      const created: EvalCase = {
        id: `case-${store.length}`,
        query,
        expectedIds,
        kind: opts?.kind ?? 'validation',
        language: opts?.language,
        framework: opts?.framework,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      store.push(created);
      return created;
    },
  };
  return { deps, store };
};

describe('generateEvalCasesFromKnowledge', () => {
  it('creates one self-retrieval case per knowledge node', () => {
    const { deps, store } = makeDeps([
      view('k1', 'How to wire the metabolism scheduler', ['typescript']),
      view('k2', 'Database-driven hot-patchable localization'),
    ]);

    const result = generateEvalCasesFromKnowledge(deps);

    expect(result.created).toBe(2);
    expect(store).toHaveLength(2);
    expect(store[0]).toMatchObject({ query: 'How to wire the metabolism scheduler', expectedIds: ['k1'], language: 'typescript' });
    expect(store[1]).toMatchObject({ expectedIds: ['k2'] });
  });

  it('is idempotent: already-covered nodes are skipped', () => {
    const views = [view('k1', 'How to wire the metabolism scheduler')];
    const { deps, store } = makeDeps(views);

    const first = generateEvalCasesFromKnowledge(deps);
    const second = generateEvalCasesFromKnowledge(deps);

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.skippedExisting).toBe(1);
    expect(store).toHaveLength(1);
  });

  it('honors the limit', () => {
    const { deps } = makeDeps([
      view('k1', 'Knowledge one title'),
      view('k2', 'Knowledge two title'),
      view('k3', 'Knowledge three title'),
    ]);

    const result = generateEvalCasesFromKnowledge(deps, { limit: 2 });
    expect(result.created).toBe(2);
  });

  it('routes every Nth generated case into the holdout partition', () => {
    const { deps, store } = makeDeps([
      view('k1', 'Knowledge one title'),
      view('k2', 'Knowledge two title'),
      view('k3', 'Knowledge three title'),
      view('k4', 'Knowledge four title'),
    ]);

    generateEvalCasesFromKnowledge(deps, { holdoutEveryNth: 2 });

    const holdout = store.filter((c) => c.kind === 'holdout');
    const validation = store.filter((c) => c.kind === 'validation');
    expect(holdout).toHaveLength(2);
    expect(validation).toHaveLength(2);
  });

  it('skips nodes with too-short titles and no usable summary', () => {
    const terse = view('k1', 'hi');
    terse.summary = '';
    const { deps, store } = makeDeps([terse]);

    const result = generateEvalCasesFromKnowledge(deps);
    expect(result.created).toBe(0);
    expect(store).toHaveLength(0);
  });
});
