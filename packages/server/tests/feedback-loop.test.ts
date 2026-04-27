/**
 * Tests for the Feedback Loop
 *
 * Covers: tracking retrieval, recording feedback, timeout resolution, stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ContextDomainType, SubstrateType } from '@mindstrate/protocol/models';
import { createTempDir, removeTempDir } from './helpers.js';

describe('FeedbackLoop', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let graphStore: ContextGraphStore;
  let feedbackLoop: FeedbackLoop;
  let nodeId: string;

  beforeEach(() => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    graphStore = new ContextGraphStore(metadataStore.getDb());
    feedbackLoop = new FeedbackLoop(metadataStore.getDb());

    const node = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.HOW_TO,
      title: 'Test graph node',
      content: 'A graph-native feedback target',
    });
    nodeId = node.id;
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('trackRetrieval', () => {
    it('should return a unique retrieval ID', () => {
      const id1 = feedbackLoop.trackRetrieval(nodeId, 'how to fix X');
      const id2 = feedbackLoop.trackRetrieval(nodeId, 'how to fix Y');
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it('should record pending signal by default', () => {
      feedbackLoop.trackRetrieval(nodeId, 'test query', 'session-1');
      const pending = feedbackLoop.getPendingFeedbacks('session-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].signal).toBe('pending');
    });
  });

  describe('recordFeedback', () => {
    it('should update signal from pending to adopted', () => {
      const rid = feedbackLoop.trackRetrieval(nodeId, 'query', 'session-1');
      feedbackLoop.recordFeedback(rid, 'adopted');

      const pending = feedbackLoop.getPendingFeedbacks('session-1');
      expect(pending).toHaveLength(0);

      const stats = feedbackLoop.getFeedbackStats(nodeId);
      expect(stats.adopted).toBe(1);
    });

    it('should update signal from pending to rejected', () => {
      const rid = feedbackLoop.trackRetrieval(nodeId, 'query', 'session-1');
      feedbackLoop.recordFeedback(rid, 'rejected', 'Not applicable to my case');

      const stats = feedbackLoop.getFeedbackStats(nodeId);
      expect(stats.rejected).toBe(1);
    });

    it('should handle non-existent retrieval ID gracefully', () => {
      // Should not throw
      feedbackLoop.recordFeedback('non-existent-id', 'adopted');
    });

    it('should record positive node feedback for adopted feedback', () => {
      const rid = feedbackLoop.trackRetrieval(nodeId, 'query');
      feedbackLoop.recordFeedback(rid, 'adopted');

      const node = graphStore.getNodeById(nodeId);
      expect(node!.positiveFeedback).toBe(1);
    });
  });

  describe('resolveTimeouts', () => {
    it('should mark all pending events in session as ignored', () => {
      const sessionId = 'session-timeout';
      feedbackLoop.trackRetrieval(nodeId, 'q1', sessionId);
      feedbackLoop.trackRetrieval(nodeId, 'q2', sessionId);

      const pendingBefore = feedbackLoop.getPendingFeedbacks(sessionId);
      expect(pendingBefore).toHaveLength(2);

      const resolved = feedbackLoop.resolveTimeouts(sessionId);
      expect(resolved).toBe(2);

      const pendingAfter = feedbackLoop.getPendingFeedbacks(sessionId);
      expect(pendingAfter).toHaveLength(0);
    });

    it('should not affect events from other sessions', () => {
      feedbackLoop.trackRetrieval(nodeId, 'q1', 'session-a');
      feedbackLoop.trackRetrieval(nodeId, 'q2', 'session-b');

      feedbackLoop.resolveTimeouts('session-a');

      const pendingB = feedbackLoop.getPendingFeedbacks('session-b');
      expect(pendingB).toHaveLength(1);
    });
  });

  describe('getFeedbackStats', () => {
    it('should return zeros for knowledge with no feedback', () => {
      const stats = feedbackLoop.getFeedbackStats(nodeId);
      expect(stats.total).toBe(0);
      expect(stats.adopted).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.adoptionRate).toBe(0);
    });

    it('should calculate adoption rate correctly', () => {
      // 2 adopted, 1 rejected, 1 partial
      const r1 = feedbackLoop.trackRetrieval(nodeId, 'q1');
      const r2 = feedbackLoop.trackRetrieval(nodeId, 'q2');
      const r3 = feedbackLoop.trackRetrieval(nodeId, 'q3');
      const r4 = feedbackLoop.trackRetrieval(nodeId, 'q4');

      feedbackLoop.recordFeedback(r1, 'adopted');
      feedbackLoop.recordFeedback(r2, 'adopted');
      feedbackLoop.recordFeedback(r3, 'rejected');
      feedbackLoop.recordFeedback(r4, 'partial');

      const stats = feedbackLoop.getFeedbackStats(nodeId);
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
      const r1 = feedbackLoop.trackRetrieval(nodeId, 'q1');
      feedbackLoop.recordFeedback(r1, 'adopted');

      const global = feedbackLoop.getGlobalStats();
      expect(global.totalEvents).toBe(1);
      expect(global.avgAdoptionRate).toBeGreaterThan(0);
    });
  });
});
