/**
 * Tests for MetadataStore
 *
 * Covers: CRUD, voting, stats, schema migration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { KnowledgeType, KnowledgeStatus, CaptureSource } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('MetadataStore', () => {
  let tempDir: string;
  let store: MetadataStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new MetadataStore(path.join(tempDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  describe('create', () => {
    it('should create a knowledge entry with generated ID', () => {
      const input = makeKnowledgeInput();
      const k = store.create(input);
      expect(k.id).toBeTruthy();
      expect(k.title).toBe(input.title);
      expect(k.type).toBe(input.type);
      expect(k.quality.status).toBe(KnowledgeStatus.PROBATION);
      expect(k.quality.score).toBe(50);
    });
  });

  describe('getById', () => {
    it('should retrieve an existing entry', () => {
      const created = store.create(makeKnowledgeInput());
      const fetched = store.getById(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });

    it('should return null for non-existent ID', () => {
      expect(store.getById('nonexistent')).toBeNull();
    });
  });

  describe('update', () => {
    it('should update title and solution', () => {
      const k = store.create(makeKnowledgeInput());
      const updated = store.update(k.id, {
        title: 'Updated title',
        solution: 'Updated solution',
      });
      expect(updated).toBeDefined();
      expect(updated!.title).toBe('Updated title');
      expect(updated!.solution).toBe('Updated solution');
      expect(updated!.version).toBe(2);
    });

    it('should return null for non-existent ID', () => {
      expect(store.update('nonexistent', { title: 'x' })).toBeNull();
    });
  });

  describe('delete', () => {
    it('should remove an entry', () => {
      const k = store.create(makeKnowledgeInput());
      expect(store.delete(k.id)).toBe(true);
      expect(store.getById(k.id)).toBeNull();
    });

    it('should return false for non-existent ID', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('vote', () => {
    it('should increment upvotes', () => {
      const k = store.create(makeKnowledgeInput());
      store.vote(k.id, 'up');
      store.vote(k.id, 'up');
      const updated = store.getById(k.id);
      expect(updated!.quality.upvotes).toBe(2);
    });

    it('should increment downvotes', () => {
      const k = store.create(makeKnowledgeInput());
      store.vote(k.id, 'down');
      const updated = store.getById(k.id);
      expect(updated!.quality.downvotes).toBe(1);
    });
  });

  describe('query', () => {
    it('should filter by type', () => {
      store.create(makeKnowledgeInput({ type: KnowledgeType.BUG_FIX }));
      store.create(makeKnowledgeInput({ type: KnowledgeType.HOW_TO, title: 'HowTo', solution: 'do this' }));

      const bugFixes = store.query({ types: [KnowledgeType.BUG_FIX] });
      expect(bugFixes.length).toBe(1);
      expect(bugFixes[0].type).toBe(KnowledgeType.BUG_FIX);
    });

    it('should filter by language', () => {
      store.create(makeKnowledgeInput({ context: { language: 'python' } }));
      store.create(makeKnowledgeInput({ title: 'TS entry', context: { language: 'typescript' } }));

      const python = store.query({ language: 'python' });
      expect(python.length).toBe(1);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 10; i++) {
        store.create(makeKnowledgeInput({ title: `Entry ${i}`, solution: `Solution ${i}` }));
      }
      const limited = store.query({}, 3);
      expect(limited).toHaveLength(3);
    });
  });

  describe('getStats', () => {
    it('should return aggregate statistics', () => {
      store.create(makeKnowledgeInput({ type: KnowledgeType.BUG_FIX }));
      store.create(makeKnowledgeInput({ type: KnowledgeType.HOW_TO, title: 'HT', solution: 'sol' }));

      const stats = store.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byType[KnowledgeType.BUG_FIX]).toBe(1);
      expect(stats.byType[KnowledgeType.HOW_TO]).toBe(1);
    });
  });

  describe('getAll', () => {
    it('should return all entries', () => {
      store.create(makeKnowledgeInput());
      store.create(makeKnowledgeInput({ title: 'Second', solution: 'sol2' }));
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe('recordUsage', () => {
    it('should increment use count and update lastUsedAt', () => {
      const k = store.create(makeKnowledgeInput());
      store.recordUsage(k.id);
      store.recordUsage(k.id);
      const updated = store.getById(k.id);
      expect(updated!.quality.useCount).toBe(2);
      expect(updated!.quality.lastUsedAt).toBeTruthy();
    });
  });
});
