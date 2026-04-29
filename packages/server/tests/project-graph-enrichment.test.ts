import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { enrichProjectGraph } from '../src/project-graph/enrichment.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('project graph LLM enrichment boundary', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir('mindstrate-project-graph-enrichment-');
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('skips enrichment when no LLM provider is configured', async () => {
    const result = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: false,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'llm_not_configured', nodesCreated: 0 });
    expect(store.listNodes({ project: 'demo', limit: 10 })).toHaveLength(0);
  });

  it('writes only evidence-backed inferred nodes from enrichment output', async () => {
    const result = await enrichProjectGraph(store, {
      project: 'demo',
      llmConfigured: true,
      summarize: async () => [
        {
          id: 'pg:demo:concept:auth-flow',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'Auth flow',
          project: 'demo',
          provenance: ProjectGraphProvenance.INFERRED,
          evidence: [{ path: 'src/auth/session.ts', extractorId: 'llm-enrichment' }],
        },
        {
          id: 'pg:demo:concept:uncited',
          kind: ProjectGraphNodeKind.CONCEPT,
          label: 'Uncited',
          project: 'demo',
          provenance: ProjectGraphProvenance.INFERRED,
          evidence: [],
        },
      ],
    });

    const nodes = store.listNodes({ project: 'demo', limit: 10 });
    expect(result.status).toBe('enriched');
    expect(result.nodesCreated).toBe(1);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].metadata?.['provenance']).toBe(ProjectGraphProvenance.INFERRED);
    expect(nodes[0].metadata?.['evidence']).toEqual([
      { path: 'src/auth/session.ts', extractorId: 'llm-enrichment' },
    ]);
  });
});
