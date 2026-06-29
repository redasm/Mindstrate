/**
 * Tests for the Embedder
 *
 * Covers: local embedding, text generation, cosine similarity properties
 */

import { describe, it, expect } from 'vitest';
import { Embedder } from '../src/processing/embedder.js';
import { KnowledgeType } from '@mindstrate/protocol';
import type { OpenAIClient } from '../src/openai-client.js';

describe('Embedder', () => {
  const embedder = new Embedder(''); // offline mode

  describe('isLocalMode', () => {
    it('should be in local mode without API key', () => {
      expect(embedder.isLocalMode()).toBe(true);
    });

    it('should be in online mode with API key', () => {
      const online = new Embedder('fake-key');
      expect(online.isLocalMode()).toBe(false);
    });
  });

  describe('knowledgeToText', () => {
    it('should concatenate knowledge fields into text', () => {
      const text = embedder.knowledgeToText({
        type: KnowledgeType.BUG_FIX,
        title: 'Fix null pointer',
        problem: 'Crashes on null input',
        solution: 'Add null check',
        tags: ['null', 'safety'],
        context: { language: 'typescript', framework: 'express' },
      });

      expect(text).toContain('[bug_fix] Fix null pointer');
      expect(text).toContain('Problem: Crashes on null input');
      expect(text).toContain('Solution: Add null check');
      expect(text).toContain('Tags: null, safety');
      expect(text).toContain('Language: typescript');
      expect(text).toContain('Framework: express');
    });

    it('should handle missing optional fields', () => {
      const text = embedder.knowledgeToText({
        type: KnowledgeType.HOW_TO,
        title: 'How to do X',
        solution: 'Do Y',
      });
      expect(text).toContain('[how_to] How to do X');
      expect(text).toContain('Solution: Do Y');
      expect(text).not.toContain('Problem:');
      expect(text).not.toContain('Tags:');
    });
  });

  describe('embed (local mode)', () => {
    it('should return a 256-dimensional vector', async () => {
      const vec = await embedder.embed('hello world typescript');
      expect(vec).toHaveLength(256);
    });

    it('should return normalized vectors (L2 norm close to 1)', async () => {
      const vec = await embedder.embed('some text for embedding');
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 3);
    });

    it('should produce similar vectors for similar text', async () => {
      const nullPointerEmbedding = await embedder.embed('fix typescript null pointer error');
      const nullReferenceEmbedding = await embedder.embed('fix typescript null reference error');
      const recipeEmbedding = await embedder.embed('cooking recipe for chocolate cake');

      const relatedSimilarity = cosine(nullPointerEmbedding, nullReferenceEmbedding);
      const unrelatedSimilarity = cosine(nullPointerEmbedding, recipeEmbedding);

      expect(relatedSimilarity).toBeGreaterThan(unrelatedSimilarity);
    });

    it('should produce deterministic results', async () => {
      const firstEmbedding = await embedder.embed('test input');
      const repeatedEmbedding = await embedder.embed('test input');
      expect(firstEmbedding).toEqual(repeatedEmbedding);
    });
  });

  describe('embedBatch', () => {
    it('should return embeddings for all texts', async () => {
      const results = await embedder.embedBatch(['text1', 'text2', 'text3']);
      expect(results).toHaveLength(3);
      for (const vec of results) {
        expect(vec).toHaveLength(256);
      }
    });

    it('should return empty array for empty input', async () => {
      const results = await embedder.embedBatch([]);
      expect(results).toEqual([]);
    });
  });

  describe('online cache and limits', () => {
    it('reuses cached embeddings for repeated online text', async () => {
      let calls = 0;
      const client = makeEmbeddingClient(async (input) => {
        calls++;
        return Array.isArray(input)
          ? input.map((_, index) => [index + 1])
          : [[42]];
      });
      const online = new Embedder('fake-key', 'test-model', undefined, { client });

      await expect(online.embed('same text')).resolves.toEqual([42]);
      await expect(online.embed('same text')).resolves.toEqual([42]);

      expect(calls).toBe(1);
      expect(online.getMetrics().cacheHits).toBe(1);
      expect(online.getMetrics().apiCalls).toBe(1);
    });

    it('deduplicates cached entries during online batches', async () => {
      let calls = 0;
      const client = makeEmbeddingClient(async (input) => {
        calls++;
        const values = Array.isArray(input) ? input : [input];
        return values.map((text) => [text.length]);
      });
      const online = new Embedder('fake-key', 'test-model', undefined, { client });

      const first = await online.embedBatch(['alpha', 'beta']);
      const second = await online.embedBatch(['alpha', 'gamma']);

      expect(first).toEqual([[5], [4]]);
      expect(second).toEqual([[5], [5]]);
      expect(calls).toBe(2);
      expect(online.getMetrics().cacheHits).toBe(1);
    });

    it('chunks large online batches to at most 10 inputs per request (DashScope cap)', async () => {
      const requestSizes: number[] = [];
      const client = makeEmbeddingClient(async (input) => {
        const values = Array.isArray(input) ? input : [input];
        requestSizes.push(values.length);
        return values.map((text) => [text.length]);
      });
      const online = new Embedder('fake-key', 'test-model', undefined, { client });

      const texts = Array.from({ length: 25 }, (_, i) => `text-${i}`);
      const results = await online.embedBatch(texts);

      // All 25 embedded, in input order, and never more than 10 per request.
      expect(results).toHaveLength(25);
      expect(results).toEqual(texts.map((t) => [t.length]));
      expect(requestSizes).toEqual([10, 10, 5]);
      expect(Math.max(...requestSizes)).toBeLessThanOrEqual(10);
    });

    it('sends the dimensions parameter when configured', async () => {
      const seen: Array<number | undefined> = [];
      const client: OpenAIClient = {
        embeddings: {
          create: async ({ input, dimensions }) => {
            seen.push(dimensions);
            const values = Array.isArray(input) ? input : [input];
            return { data: values.map((_, index) => ({ embedding: [1, 2, 3], index })) };
          },
        },
        chat: { completions: { create: async () => ({ choices: [] }) } },
      };
      const online = new Embedder('fake-key', 'text-embedding-v4', undefined, { client, dimensions: 1024 });
      await online.embed('single');
      await online.embedBatch(['a', 'b']);
      expect(seen).toEqual([1024, 1024]);
    });

    it('omits dimensions when not configured', async () => {
      const seen: Array<number | undefined> = [];
      const client: OpenAIClient = {
        embeddings: {
          create: async ({ input, dimensions }) => {
            seen.push(dimensions);
            const values = Array.isArray(input) ? input : [input];
            return { data: values.map((_, index) => ({ embedding: [1, 2, 3], index })) };
          },
        },
        chat: { completions: { create: async () => ({ choices: [] }) } },
      };
      const online = new Embedder('fake-key', 'text-embedding-ada-002', undefined, { client });
      await online.embed('single');
      expect(seen).toEqual([undefined]);
    });
  });
});

function makeEmbeddingClient(
  createEmbeddings: (input: string | string[]) => Promise<number[][]>,
): OpenAIClient {
  return {
    embeddings: {
      create: async ({ input }) => ({
        data: (await createEmbeddings(input)).map((embedding, index) => ({ embedding, index })),
      }),
    },
    chat: {
      completions: {
        create: async () => ({ choices: [] }),
      },
    },
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
