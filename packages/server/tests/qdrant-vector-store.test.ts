import { afterEach, describe, expect, it, vi } from 'vitest';
import { QdrantVectorStore } from '../src/storage/qdrant-vector-store.js';

describe('QdrantVectorStore', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('creates the configured collection during initialization', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    mockFetch(requests, { result: true });

    const store = new QdrantVectorStore({
      url: 'http://qdrant.test',
      collectionName: 'mindstrate',
      dimension: 1536,
    });
    await store.initialize();

    expect(requests[0].url).toBe('http://qdrant.test/collections/mindstrate');
    expect(JSON.parse(requests[0].init.body as string)).toMatchObject({
      vectors: { size: 1536, distance: 'Cosine' },
    });
  });

  it('upserts vectors and maps search results back to vector documents', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    mockFetch(requests, {
      result: [
        {
          id: 'node-1',
          score: 0.94,
          payload: {
            text: 'cached guidance',
            metadata: { project: 'proj-a' },
          },
        },
      ],
    });

    const store = new QdrantVectorStore({
      url: 'http://qdrant.test/',
      collectionName: 'mindstrate',
      dimension: 3,
      apiKey: 'secret',
    });
    await store.add({
      id: 'node-1',
      embedding: [1, 0, 0],
      text: 'cached guidance',
      metadata: { project: 'proj-a' },
    });
    const results = await store.search([1, 0, 0], 5, { project: 'proj-a' });

    expect(requests[0].url).toContain('/points?wait=true');
    expect((requests[0].init.headers as Record<string, string>)['api-key']).toBe('secret');
    expect(JSON.parse(requests[1].init.body as string).filter).toMatchObject({
      must: [{ key: 'metadata.project', match: { value: 'proj-a' } }],
    });
    expect(results).toEqual([{
      id: 'node-1',
      score: 0.94,
      distance: 0.06000000000000005,
      text: 'cached guidance',
      metadata: { project: 'proj-a' },
    }]);
  });
});

function mockFetch(
  requests: Array<{ url: string; init: RequestInit }>,
  json: unknown,
): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return {
      ok: true,
      status: 200,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as Response;
  }) as typeof fetch;
}
