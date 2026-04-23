/**
 * Tests for the Vector Store
 *
 * Covers: add, search, dedup, delete, persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { VectorStore } from '../src/storage/vector-store.js';
import type { VectorDocument } from '../src/storage/vector-store-interface.js';
import { createTempDir, removeTempDir } from './helpers.js';

function makeDoc(id: string, values: number[]): VectorDocument {
  return {
    id,
    embedding: values,
    text: `text for ${id}`,
    metadata: { type: 'bug_fix', language: 'typescript' },
  };
}

// Generate a simple normalized vector with a distinctive pattern
function makeEmbedding(seed: number, dim: number = 16): number[] {
  const vec = Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map(v => v / (norm || 1));
}

describe('VectorStore', () => {
  let tempDir: string;
  let store: VectorStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new VectorStore(path.join(tempDir, 'vectors'), 'test');
  });

  afterEach(() => {
    removeTempDir(tempDir);
  });

  describe('add and count', () => {
    it('should start empty', async () => {
      expect(await store.count()).toBe(0);
    });

    it('should add a document', async () => {
      await store.add(makeDoc('doc1', makeEmbedding(1)));
      expect(await store.count()).toBe(1);
    });

    it('should upsert existing document', async () => {
      await store.add(makeDoc('doc1', makeEmbedding(1)));
      await store.add(makeDoc('doc1', makeEmbedding(2)));
      expect(await store.count()).toBe(1);
    });
  });

  describe('search', () => {
    it('should find the most similar document', async () => {
      await store.add(makeDoc('a', makeEmbedding(1)));
      await store.add(makeDoc('b', makeEmbedding(2)));
      await store.add(makeDoc('c', makeEmbedding(3)));

      const results = await store.search(makeEmbedding(1), 2);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('a');
      expect(results[0].score).toBeCloseTo(1.0, 3);
    });

    it('should filter by metadata', async () => {
      await store.add({ id: 'ts', embedding: makeEmbedding(1), text: 't', metadata: { language: 'typescript' } });
      await store.add({ id: 'py', embedding: makeEmbedding(2), text: 'p', metadata: { language: 'python' } });

      const results = await store.search(makeEmbedding(1), 5, { language: 'python' });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('py');
    });

    it('should return empty for empty store', async () => {
      const results = await store.search(makeEmbedding(1), 5);
      expect(results).toHaveLength(0);
    });
  });

  describe('findDuplicates', () => {
    it('should find duplicates above threshold', async () => {
      const emb = makeEmbedding(42);
      await store.add(makeDoc('existing', emb));

      const dupes = await store.findDuplicates(emb, 0.99);
      expect(dupes).toHaveLength(1);
      expect(dupes[0].id).toBe('existing');
    });

    it('should not find duplicates below threshold', async () => {
      await store.add(makeDoc('other', makeEmbedding(1)));
      const dupes = await store.findDuplicates(makeEmbedding(99), 0.99);
      expect(dupes).toHaveLength(0);
    });
  });

  describe('delete', () => {
    it('should remove a document', async () => {
      await store.add(makeDoc('doc1', makeEmbedding(1)));
      expect(await store.count()).toBe(1);

      await store.delete('doc1');
      expect(await store.count()).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist data to disk and reload', async () => {
      const storagePath = path.join(tempDir, 'persist-test');
      const s1 = new VectorStore(storagePath, 'test');
      await s1.add(makeDoc('saved', makeEmbedding(7)));
      s1.flush();

      // Create a new instance reading the same file
      const s2 = new VectorStore(storagePath, 'test');
      expect(await s2.count()).toBe(1);
      const results = await s2.search(makeEmbedding(7), 1);
      expect(results[0].id).toBe('saved');
    });

    it('should handle corrupted file gracefully', () => {
      const storagePath = path.join(tempDir, 'corrupt-test');
      fs.mkdirSync(storagePath, { recursive: true });
      fs.writeFileSync(path.join(storagePath, 'test.vectors.json'), 'NOT VALID JSON');

      // Should not throw, should create empty index
      const s = new VectorStore(storagePath, 'test');
      expect(s).toBeDefined();
    });
  });

  describe('addBatch', () => {
    it('should add multiple documents at once', async () => {
      await store.addBatch([
        makeDoc('a', makeEmbedding(1)),
        makeDoc('b', makeEmbedding(2)),
        makeDoc('c', makeEmbedding(3)),
      ]);
      expect(await store.count()).toBe(3);
    });
  });
});
