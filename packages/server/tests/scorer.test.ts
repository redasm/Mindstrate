/**
 * Tests for the Quality Scorer
 *
 * Covers: score calculation, status determination, maintenance cycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { QualityScorer } from '../src/quality/scorer.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { KnowledgeStatus, CaptureSource, KnowledgeType } from '@mindstrate/protocol';
import type { KnowledgeUnit } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

function makeKnowledge(overrides: Partial<KnowledgeUnit> = {}): KnowledgeUnit {
  return {
    id: 'test-id',
    version: 1,
    type: KnowledgeType.BUG_FIX,
    title: 'Test',
    solution: 'Test solution',
    tags: [],
    context: { language: 'typescript' },
    metadata: {
      author: 'tester',
      source: CaptureSource.CLI,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      confidence: 0.5,
    },
    quality: {
      score: 50,
      upvotes: 0,
      downvotes: 0,
      useCount: 0,
      verified: false,
      status: KnowledgeStatus.PROBATION,
    },
    ...overrides,
  };
}

describe('QualityScorer', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let feedbackLoop: FeedbackLoop;
  let scorer: QualityScorer;

  beforeEach(() => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    feedbackLoop = new FeedbackLoop(metadataStore.getDb());
    scorer = new QualityScorer(metadataStore, feedbackLoop);
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('calculateScore', () => {
    it('should return base score of 50 for a default knowledge entry', () => {
      const k = makeKnowledge();
      const score = scorer.calculateScore(k);
      expect(score).toBe(50);
    });

    it('should increase score with upvotes', () => {
      const k = makeKnowledge({ quality: { ...makeKnowledge().quality, upvotes: 3 } });
      const score = scorer.calculateScore(k);
      expect(score).toBeGreaterThan(50);
      expect(score).toBe(50 + 3 * 5); // 65
    });

    it('should decrease score with downvotes (heavier penalty)', () => {
      const k = makeKnowledge({ quality: { ...makeKnowledge().quality, downvotes: 2 } });
      const score = scorer.calculateScore(k);
      expect(score).toBeLessThan(50);
      expect(score).toBe(50 - 2 * 10); // 30
    });

    it('should increase score with use count (capped at 20)', () => {
      const k = makeKnowledge({ quality: { ...makeKnowledge().quality, useCount: 15 } });
      const score = scorer.calculateScore(k);
      // useCount contribution = min(15*2, 20) = 20
      expect(score).toBe(50 + 20);
    });

    it('should increase score when verified', () => {
      const k = makeKnowledge({ quality: { ...makeKnowledge().quality, verified: true } });
      const score = scorer.calculateScore(k);
      expect(score).toBe(50 + 15);
    });

    it('should increase score for PR review source', () => {
      const k = makeKnowledge({
        metadata: { ...makeKnowledge().metadata, source: CaptureSource.PR_REVIEW },
      });
      const score = scorer.calculateScore(k);
      expect(score).toBe(50 + 5);
    });

    it('should increase score for actionable guidance', () => {
      const k = makeKnowledge({
        actionable: {
          steps: ['step1', 'step2'],
          preconditions: ['pre1'],
          verification: 'verify',
          antiPatterns: ['anti1'],
        },
      });
      const score = scorer.calculateScore(k);
      // steps +3, preconditions +1, verification +1, antiPatterns +2 = 7
      expect(score).toBe(50 + 7);
    });

    it('should add score for evolution history', () => {
      const k = makeKnowledge({
        evolution: [
          { type: 'improved', timestamp: '', description: 'improved' },
          { type: 'validated', timestamp: '', description: 'validated' },
          { type: 'merged', timestamp: '', description: 'merged' },
        ],
      });
      const score = scorer.calculateScore(k);
      // improved +3, validated +5, merged +2 = 10
      expect(score).toBe(50 + 10);
    });

    it('should clamp score between 0 and 100', () => {
      const kLow = makeKnowledge({
        quality: { ...makeKnowledge().quality, downvotes: 20 },
      });
      expect(scorer.calculateScore(kLow)).toBe(0);

      const kHigh = makeKnowledge({
        quality: {
          ...makeKnowledge().quality,
          upvotes: 20,
          useCount: 50,
          verified: true,
        },
        metadata: { ...makeKnowledge().metadata, source: CaptureSource.PR_REVIEW, confidence: 1 },
        actionable: { steps: ['a'], preconditions: ['b'], verification: 'c', antiPatterns: ['d'] },
        evolution: [
          { type: 'improved', timestamp: '', description: '' },
          { type: 'improved', timestamp: '', description: '' },
          { type: 'improved', timestamp: '', description: '' },
          { type: 'validated', timestamp: '', description: '' },
          { type: 'validated', timestamp: '', description: '' },
        ],
      });
      expect(scorer.calculateScore(kHigh)).toBe(100);
    });
  });

  describe('determineStatus', () => {
    it('should deprecate when score < 20', () => {
      const k = makeKnowledge();
      const status = scorer.determineStatus(k, 15);
      expect(status).toBe(KnowledgeStatus.DEPRECATED);
    });

    it('should keep verified when score >= 30', () => {
      const k = makeKnowledge({
        quality: { ...makeKnowledge().quality, verified: true },
      });
      const status = scorer.determineStatus(k, 50);
      expect(status).toBe(KnowledgeStatus.VERIFIED);
    });

    it('should activate when useCount >= 3 and more upvotes than downvotes', () => {
      const k = makeKnowledge({
        quality: { ...makeKnowledge().quality, useCount: 5, upvotes: 2, downvotes: 0 },
      });
      const status = scorer.determineStatus(k, 50);
      expect(status).toBe(KnowledgeStatus.ACTIVE);
    });

    it('should mark as outdated when unused for 6+ months', () => {
      const sixMonthsAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const k = makeKnowledge({
        quality: { ...makeKnowledge().quality, lastUsedAt: sixMonthsAgo },
      });
      const status = scorer.determineStatus(k, 50);
      expect(status).toBe(KnowledgeStatus.OUTDATED);
    });

    it('should stay on probation by default', () => {
      const k = makeKnowledge();
      const status = scorer.determineStatus(k, 50);
      expect(status).toBe(KnowledgeStatus.PROBATION);
    });
  });

  describe('runMaintenance', () => {
    it('should update scores and statuses for all knowledge', async () => {
      // Add some knowledge via metadata store directly
      const input = makeKnowledgeInput();
      metadataStore.create(input);
      metadataStore.create(makeKnowledgeInput({ title: 'Second entry', solution: 'Different solution' }));

      const result = scorer.runMaintenance();
      expect(result.total).toBe(2);
      expect(result.updated).toBeGreaterThanOrEqual(0);
    });
  });
});
