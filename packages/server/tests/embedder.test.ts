/**
 * Tests for the Embedder
 *
 * Covers: local embedding, text generation, cosine similarity properties
 */

import { describe, it, expect } from 'vitest';
import { Embedder } from '../src/processing/embedder.js';
import { KnowledgeType } from '@mindstrate/protocol';

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
      const v1 = await embedder.embed('fix typescript null pointer error');
      const v2 = await embedder.embed('fix typescript null reference error');
      const v3 = await embedder.embed('cooking recipe for chocolate cake');

      const sim12 = cosine(v1, v2);
      const sim13 = cosine(v1, v3);

      expect(sim12).toBeGreaterThan(sim13);
    });

    it('should produce deterministic results', async () => {
      const v1 = await embedder.embed('test input');
      const v2 = await embedder.embed('test input');
      expect(v1).toEqual(v2);
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
});

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
