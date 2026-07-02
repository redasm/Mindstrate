import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QdrantNodeVectorIndex,
  type NodeVectorHit,
  type NodeVectorIndex,
  type NodeVectorQuery,
} from '../src/context-graph/node-vector-index.js';

/** In-memory stand-in for the SQLite index, to observe fallback. */
class StubIndex implements NodeVectorIndex {
  searchCalls = 0;
  constructor(private readonly hits: NodeVectorHit[]) {}
  async search(_query: NodeVectorQuery): Promise<NodeVectorHit[]> {
    this.searchCalls++;
    return this.hits;
  }
  async upsert(): Promise<void> {}
  async deleteForProject(): Promise<void> {}
}

const query: NodeVectorQuery = {
  queryEmbedding: [1, 0, 0],
  model: 'test',
  topK: 5,
  minScore: 0,
};

describe('QdrantNodeVectorIndex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the SQLite index when Qdrant is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const fallback = new StubIndex([{ nodeId: 'from-sqlite', score: 0.9 }]);
    const warnings: string[] = [];
    const index = new QdrantNodeVectorIndex({
      url: 'http://qdrant.invalid:6333',
      collectionName: 'mindstrate-nodes',
      dimension: 3,
      fallback,
      warn: (m) => warnings.push(m),
    });

    const hits = await index.search(query);
    expect(hits).toEqual([{ nodeId: 'from-sqlite', score: 0.9 }]);
    expect(fallback.searchCalls).toBe(1);
    expect(warnings.some((w) => w.includes('falling back to SQLite'))).toBe(true);
  });

  it('never throws from upsert/delete even when Qdrant is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const fallback = new StubIndex([]);
    const index = new QdrantNodeVectorIndex({
      url: 'http://qdrant.invalid:6333',
      collectionName: 'mindstrate-nodes',
      dimension: 3,
      fallback,
    });

    await expect(
      index.upsert([{ nodeId: 'n1', project: 'p', model: 'test', embedding: [1, 0, 0] }]),
    ).resolves.toBeUndefined();
    await expect(index.deleteForProject('p')).resolves.toBeUndefined();
  });

  it('parses Qdrant hits and maps payload nodeId back out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      // ensureCollection PUT has `vectors`; search POST has `vector`.
      if (body.vectors) return new Response('{}', { status: 200 });
      return new Response(
        JSON.stringify({ result: [{ id: 'uuid', score: 0.83, payload: { nodeId: 'real-node-id' } }] }),
        { status: 200 },
      );
    });
    const index = new QdrantNodeVectorIndex({
      url: 'http://qdrant.local:6333',
      collectionName: 'mindstrate-nodes',
      dimension: 3,
      fallback: new StubIndex([]),
    });

    const hits = await index.search(query);
    expect(hits).toEqual([{ nodeId: 'real-node-id', score: 0.83 }]);
  });
});

