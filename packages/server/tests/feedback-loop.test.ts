/**
 * Tests for the Feedback Loop
 *
 * Covers: tracking retrieval, recording feedback, timeout resolution, stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('FeedbackLoop', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let feedbackLoop: FeedbackLoop;
  let knowledgeId: string;

  beforeEach(() => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    feedbackLoop = new FeedbackLoop(metadataStore.getDb(), metadataStore);

    // Create a knowledge entry to reference
    const k = metadataStore.create(makeKnowledgeInput());
    knowledgeId = k.id;
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('trackRetrieval', () => {
    it('should return a unique retrieval ID', () => {
      const id1 = feedbackLoop.trackRetrieval(knowledgeId, 'how to fix X');
      const id2 = feedbackLoop.trackRetrieval(knowledgeId, 'how to fix Y');
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should record pending signal by default', () => {
      feedbackLoop.trackRetrieval(knowledgeId, 'test query', 'session-1');
      const pending = feedbackLoop.getPendingFeedbacks('session-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].signal).toBe('pending');
    });
  });

  describe('recordFeedback', () => {
    it('should update signal from pending to adopted', () => {
      const rid = feedbackLoop.trackRetrieval(knowledgeId, 'query', 'session-1');
      feedbackLoop.recordFeedback(rid, 'adopted');

      const pending = feedbackLoop.getPendingFeedbacks('session-1');
      expect(pending).toHaveLength(0);

      const stats = feedbackLoop.getFeedbackStats(knowledgeId);
      expect(stats.adopted).toBe(1);
    });

    it('should update signal from pending to rejected', () => {
      const rid = feedbackLoop.trackRetrieval(knowledgeId, 'query', 'session-1');
      feedbackLoop.recordFeedback(rid, 'rejected', 'Not applicable to my case');

      const stats = feedbackLoop.getFeedbackStats(knowledgeId);
      expect(stats.rejected).toBe(1);
    });

    it('should handle non-existent retrieval ID gracefully', () => {
      // Should not throw
      feedbackLoop.recordFeedback('non-existent-id', 'adopted');
    });

    it('should record usage for adopted feedback', () => {
      const rid = feedbackLoop.trackRetrieval(knowledgeId, 'query');
      feedbackLoop.recordFeedback(rid, 'adopted');

      const k = metadataStore.getById(knowledgeId);
      expect(k!.quality.useCount).toBe(1);
    });
  });

  describe('resolveTimeouts', () => {
    it('should mark all pending events in session as ignored', () => {
      const sessionId = 'session-timeout';
      feedbackLoop.trackRetrieval(knowledgeId, 'q1', sessionId);
      feedbackLoop.trackRetrieval(knowledgeId, 'q2', sessionId);

      const pendingBefore = feedbackLoop.getPendingFeedbacks(sessionId);
      expect(pendingBefore).toHaveLength(2);

      const resolved = feedbackLoop.resolveTimeouts(sessionId);
      expect(resolved).toBe(2);

      const pendingAfter = feedbackLoop.getPendingFeedbacks(sessionId);
      expect(pendingAfter).toHaveLength(0);
    });

    it('should not affect events from other sessions', () => {
      feedbackLoop.trackRetrieval(knowledgeId, 'q1', 'session-a');
      feedbackLoop.trackRetrieval(knowledgeId, 'q2', 'session-b');

      feedbackLoop.resolveTimeouts('session-a');

      const pendingB = feedbackLoop.getPendingFeedbacks('session-b');
      expect(pendingB).toHaveLength(1);
    });
  });

  describe('getFeedbackStats', () => {
    it('should return zeros for knowledge with no feedback', () => {
      const stats = feedbackLoop.getFeedbackStats(knowledgeId);
      expect(stats.total).toBe(0);
      expect(stats.adopted).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.adoptionRate).toBe(0);
    });

    it('should calculate adoption rate correctly', () => {
      // 2 adopted, 1 rejected, 1 partial
      const r1 = feedbackLoop.trackRetrieval(knowledgeId, 'q1');
      const r2 = feedbackLoop.trackRetrieval(knowledgeId, 'q2');
      const r3 = feedbackLoop.trackRetrieval(knowledgeId, 'q3');
      const r4 = feedbackLoop.trackRetrieval(knowledgeId, 'q4');

      feedbackLoop.recordFeedback(r1, 'adopted');
      feedbackLoop.recordFeedback(r2, 'adopted');
      feedbackLoop.recordFeedback(r3, 'rejected');
      feedbackLoop.recordFeedback(r4, 'partial');

      const stats = feedbackLoop.getFeedbackStats(knowledgeId);
      expect(stats.total).toBe(4);
      expect(stats.adopted).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.partial).toBe(1);
      // adoptionRate = (2 + 1*0.5) / 4 = 0.625
      expect(stats.adoptionRate).toBeCloseTo(0.625);
    });
  });

  describe('getGlobalStats', () => {
    it('should aggregate stats across all knowledge', () => {
      const r1 = feedbackLoop.trackRetrieval(knowledgeId, 'q1');
      feedbackLoop.recordFeedback(r1, 'adopted');

      const global = feedbackLoop.getGlobalStats();
      expect(global.totalEvents).toBe(1);
      expect(global.avgAdoptionRate).toBeGreaterThan(0);
    });
  });
});
