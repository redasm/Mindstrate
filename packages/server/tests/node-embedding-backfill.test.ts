/**
 * Node-embedding backfill streaming.
 *
 * The backfill used to materialize the whole node set with
 * `list({ limit: 100000 })`, which OOM-crashed the 512MB team-server on 100k+
 * node graphs and left coverage stuck at single-digit percent. It now pages by
 * primary key (keyset), touching O(batchSize) nodes at a time. These tests pin
 * the behavior that matters: full coverage across many pages, a working
 * DB-side incremental guard, and accurate candidate/skip accounting — all with
 * a batch size far smaller than the node count so the paging loop is exercised.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { backfillNodeEmbeddings } from '../src/context-graph/node-embedding-backfill.js';
import type { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './test-support.js';

const MODEL = 'test-model';
const DIM = 4;

/** Deterministic stub embedder — no API, one vector per input. */
function stubEmbedder(): Embedder {
  return {
    getEmbeddingDimension: () => DIM,
    embedBatch: async (texts: string[]) =>
      texts.map((_t, i) => Array.from({ length: DIM }, (_v, k) => (i + k) / 10)),
  } as unknown as Embedder;
}

describe('backfillNodeEmbeddings (streaming)', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  function addNodes(count: number, project = 'demo'): void {
    for (let i = 0; i < count; i++) {
      store.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: `file-${String(i).padStart(3, '0')}.ts`,
        content: `file: file-${i}.ts`,
        project,
        tags: ['project-graph', 'file'],
        status: ContextNodeStatus.ACTIVE,
        metadata: { projectGraph: true, kind: 'file' },
      });
    }
  }

  it('embeds every node when the candidate set spans many keyset pages', async () => {
    addNodes(150);

    const result = await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, {
      project: 'demo',
      batchSize: 7, // 150 nodes / 7 => ~22 pages
    });

    expect(result.candidates).toBe(150);
    expect(result.embedded).toBe(150);
    expect(result.skipped).toBe(0);
    // Every node now has a row for this model.
    expect(store.nodeIdsWithEmbedding(MODEL).size).toBe(150);
  });

  it('is incremental: a re-run skips already-embedded nodes via the DB anti-join', async () => {
    addNodes(30);
    await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, { project: 'demo', batchSize: 8 });

    // Add more nodes, then re-run WITHOUT force.
    addNodes(10);
    const second = await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, {
      project: 'demo',
      batchSize: 8,
    });

    expect(second.candidates).toBe(40);
    expect(second.embedded).toBe(10); // only the new ones
    expect(second.skipped).toBe(30);
    expect(store.nodeIdsWithEmbedding(MODEL).size).toBe(40);
  });

  it('force re-embeds the entire candidate set across pages', async () => {
    addNodes(25);
    await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, { project: 'demo', batchSize: 6 });

    const forced = await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, {
      project: 'demo',
      batchSize: 6,
      force: true,
    });

    expect(forced.candidates).toBe(25);
    expect(forced.embedded).toBe(25);
    expect(forced.skipped).toBe(0);
  });

  it('reports progress totals against the pending count', async () => {
    addNodes(20);
    const seen: Array<{ embedded: number; total: number }> = [];
    await backfillNodeEmbeddings(store, stubEmbedder(), MODEL, {
      project: 'demo',
      batchSize: 5,
      onProgress: (p) => seen.push(p),
    });

    expect(seen.length).toBeGreaterThan(1); // multiple pages
    expect(seen.every((p) => p.total === 20)).toBe(true);
    expect(seen[seen.length - 1].embedded).toBe(20);
  });
});
