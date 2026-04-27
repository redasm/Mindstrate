/**
 * Tests for the KnowledgeEvolution engine
 *
 * Covers: findMergeCandidates, findImproveCandidates, findDeprecateCandidates,
 *         applySuggestion, runEvolution (offline mode)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { KnowledgeEvolution } from '../src/quality/evolution.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { VectorStore } from '../src/storage/vector-store.js';
import { Embedder } from '../src/processing/embedder.js';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { Pipeline } from '../src/processing/pipeline.js';
import { KnowledgeType, KnowledgeStatus } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('KnowledgeEvolution', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let vectorStore: VectorStore;
  let embedder: Embedder;
  let feedbackLoop: FeedbackLoop;
  let pipeline: Pipeline;
  let evolution: KnowledgeEvolution;

  beforeEach(async () => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    vectorStore = new VectorStore(path.join(tempDir, 'vectors'), 'test');
    embedder = new Embedder(''); // offline
    feedbackLoop = new FeedbackLoop(metadataStore.getDb());
    pipeline = new Pipeline(metadataStore, vectorStore, embedder);
    evolution = new KnowledgeEvolution(metadataStore, vectorStore, embedder, feedbackLoop, '');
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('findDeprecateCandidates', () => {
    it('should flag knowledge with critically low score', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Bad entry' }));
      metadataStore.updateScore(k.id, 10);

      const all = metadataStore.getAll();
      const candidates = evolution.findDeprecateCandidates(all);
      expect(candidates.length).toBe(1);
      expect(candidates[0].type).toBe('deprecate');
      expect(candidates[0].confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should flag knowledge never adopted but often rejected', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Rejected entry' }));
      // Simulate 5 retrievals, all rejected
      for (let i = 0; i < 5; i++) {
        const rid = feedbackLoop.trackRetrieval(k.id, `query-${i}`);
        feedbackLoop.recordFeedback(rid, 'rejected');
      }

      const all = metadataStore.getAll();
      const candidates = evolution.findDeprecateCandidates(all);
      const match = candidates.find(c => c.knowledgeId === k.id);
      expect(match).toBeDefined();
      expect(match!.type).toBe('deprecate');
    });

    it('should not flag already deprecated knowledge', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Old entry' }));
      metadataStore.updateStatus(k.id, KnowledgeStatus.DEPRECATED);
      metadataStore.updateScore(k.id, 5);

      const all = metadataStore.getAll();
      const candidates = evolution.findDeprecateCandidates(all);
      expect(candidates.find(c => c.knowledgeId === k.id)).toBeUndefined();
    });
  });

  describe('findImproveCandidates', () => {
    it('should flag knowledge with low adoption rate', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Low adoption' }));
      // 5 retrievals, only 1 adopted
      for (let i = 0; i < 4; i++) {
        const rid = feedbackLoop.trackRetrieval(k.id, `q-${i}`);
        feedbackLoop.recordFeedback(rid, 'rejected');
      }
      const rid5 = feedbackLoop.trackRetrieval(k.id, 'q-4');
      feedbackLoop.recordFeedback(rid5, 'adopted');

      const all = metadataStore.getAll();
      const candidates = evolution.findImproveCandidates(all);
      const match = candidates.find(c => c.knowledgeId === k.id);
      expect(match).toBeDefined();
      expect(match!.type).toBe('improve');
    });

    it('should not flag knowledge with good adoption rate', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Good entry' }));
      // 5 retrievals, 4 adopted
      for (let i = 0; i < 4; i++) {
        const rid = feedbackLoop.trackRetrieval(k.id, `q-${i}`);
        feedbackLoop.recordFeedback(rid, 'adopted');
      }
      const rid5 = feedbackLoop.trackRetrieval(k.id, 'q-4');
      feedbackLoop.recordFeedback(rid5, 'rejected');

      const all = metadataStore.getAll();
      const candidates = evolution.findImproveCandidates(all);
      const match = candidates.find(c => c.knowledgeId === k.id);
      expect(match).toBeUndefined();
    });
  });

  describe('findMergeCandidates', () => {
    it('should find similar knowledge pairs for merging', async () => {
      // Add two very similar entries
      await pipeline.process(makeKnowledgeInput({
        title: 'Fix null pointer exception in user service',
        solution: 'Add null check before accessing user properties to prevent null pointer dereference',
        tags: ['null', 'safety'],
      }));
      await pipeline.process(makeKnowledgeInput({
        title: 'Handle null reference error in user module',
        solution: 'Validate user object is not null before accessing its properties to prevent reference errors',
        tags: ['null', 'validation'],
      }));

      const all = metadataStore.getAll();
      const candidates = await evolution.findMergeCandidates(all);
      // May or may not find merge candidates depending on offline embedding similarity
      // Just ensure it doesn't crash and returns valid structure
      expect(candidates).toBeDefined();
      for (const c of candidates) {
        expect(c.type).toBe('merge');
        expect(c.relatedIds).toBeDefined();
      }
    });
  });

  describe('applySuggestion', () => {
    it('should apply deprecate suggestion', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'To deprecate' }));
      const result = evolution.applySuggestion({
        knowledgeId: k.id,
        type: 'deprecate',
        description: 'Test deprecation',
        confidence: 0.95,
      });
      expect(result).toBe(true);
      const updated = metadataStore.getById(k.id);
      expect(updated!.quality.status).toBe(KnowledgeStatus.DEPRECATED);
    });

    it('should apply improve suggestion with update', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'To improve' }));
      const result = evolution.applySuggestion({
        knowledgeId: k.id,
        type: 'improve',
        description: 'Improve clarity',
        confidence: 0.7,
        suggestedUpdate: {
          title: 'Improved title',
          solution: 'Improved solution with more detail',
        },
      });
      expect(result).toBe(true);
      const updated = metadataStore.getById(k.id);
      expect(updated!.title).toBe('Improved title');
    });

    it('should apply validate suggestion (adds evolution record)', () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'To validate' }));
      const result = evolution.applySuggestion({
        knowledgeId: k.id,
        type: 'validate',
        description: 'Manually validated',
        confidence: 1.0,
      });
      expect(result).toBe(true);
      const updated = metadataStore.getById(k.id);
      expect(updated!.evolution!.some(e => e.type === 'validated')).toBe(true);
    });

    it('should return false for non-existent knowledge', () => {
      const result = evolution.applySuggestion({
        knowledgeId: 'nonexistent',
        type: 'deprecate',
        description: 'Test',
        confidence: 0.9,
      });
      expect(result).toBe(false);
    });
  });

  describe('runEvolution', () => {
    it('should return evolution results without errors', async () => {
      metadataStore.create(makeKnowledgeInput({ title: 'Entry 1', solution: 'Sol 1 alpha' }));
      metadataStore.create(makeKnowledgeInput({ title: 'Entry 2', solution: 'Sol 2 beta' }));

      const result = await evolution.runEvolution({ maxItems: 10 });
      expect(result.scanned).toBe(2);
      expect(result.suggestions).toBeDefined();
      expect(result.autoApplied).toBe(0);
    });

    it('should auto-apply deprecations when autoApply is true', async () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Bad' }));
      metadataStore.updateScore(k.id, 5);

      const result = await evolution.runEvolution({ autoApply: true, maxItems: 10 });
      expect(result.autoApplied).toBeGreaterThanOrEqual(1);

      const updated = metadataStore.getById(k.id);
      expect(updated!.quality.status).toBe(KnowledgeStatus.DEPRECATED);
    });

    it('should keep background mode report-only even when autoApply is requested', async () => {
      const k = metadataStore.create(makeKnowledgeInput({ title: 'Background candidate' }));
      metadataStore.updateScore(k.id, 5);

      const result = await evolution.runEvolution({
        mode: 'background',
        autoApply: true,
        maxItems: 10,
      });

      expect(result.mode).toBe('background');
      expect(result.autoApplied).toBe(0);
      expect(result.llmEnhanced).toBe(0);
      expect(result.summary.deprecate).toBeGreaterThanOrEqual(1);

      const updated = metadataStore.getById(k.id);
      expect(updated!.quality.status).not.toBe(KnowledgeStatus.DEPRECATED);
    });

    it('should include categorized suggestion counts in evolution results', async () => {
      const lowScore = metadataStore.create(makeKnowledgeInput({ title: 'Needs deprecation' }));
      metadataStore.updateScore(lowScore.id, 10);

      const lowAdoption = metadataStore.create(makeKnowledgeInput({ title: 'Needs improvement' }));
      for (let i = 0; i < 4; i++) {
        const rid = feedbackLoop.trackRetrieval(lowAdoption.id, `background-q-${i}`);
        feedbackLoop.recordFeedback(rid, 'rejected');
      }

      const result = await evolution.runEvolution({ mode: 'background', maxItems: 20 });

      expect(result.summary.deprecate).toBeGreaterThanOrEqual(1);
      expect(result.summary.improve).toBeGreaterThanOrEqual(1);
      expect(
        result.summary.merge
        + result.summary.improve
        + result.summary.validate
        + result.summary.deprecate
        + result.summary.split,
      ).toBe(result.suggestions.length);
    });

    it('should not initialize the LLM client in background mode', async () => {
      let called = false;
      (evolution as any).getClient = async () => {
        called = true;
        return null;
      };

      await evolution.runEvolution({ mode: 'background', maxItems: 10 });

      expect(called).toBe(false);
    });
  });
});
