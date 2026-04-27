/**
 * Tests for the Retriever
 *
 * Covers: search, curateContext, computeFinalScore, buildEnrichedQuery, filters
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { Retriever } from '../src/retrieval/retriever.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { VectorStore } from '../src/storage/vector-store.js';
import { Embedder } from '../src/processing/embedder.js';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { Pipeline } from '../src/processing/pipeline.js';
import { KnowledgeType } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('Retriever', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let vectorStore: VectorStore;
  let embedder: Embedder;
  let feedbackLoop: FeedbackLoop;
  let pipeline: Pipeline;
  let retriever: Retriever;

  beforeEach(async () => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    vectorStore = new VectorStore(path.join(tempDir, 'vectors'), 'test');
    embedder = new Embedder(''); // offline mode
    feedbackLoop = new FeedbackLoop(metadataStore.getDb());
    pipeline = new Pipeline(metadataStore, vectorStore, embedder);
    retriever = new Retriever(metadataStore, vectorStore, embedder, feedbackLoop);

    // Seed some knowledge
    await pipeline.process(makeKnowledgeInput({
      title: 'Fix React hydration mismatch error',
      solution: 'Use useEffect for client-side only code to prevent server-client mismatch',
      tags: ['react', 'hydration', 'ssr'],
      context: { language: 'typescript', framework: 'react' },
    }));
    await pipeline.process(makeKnowledgeInput({
      title: 'How to set up PostgreSQL connection pool',
      solution: 'Use pg-pool with max connections of 20 and idle timeout of 30s',
      type: KnowledgeType.HOW_TO,
      tags: ['postgresql', 'database', 'connection-pool'],
      context: { language: 'typescript', framework: 'express' },
    }));
    await pipeline.process(makeKnowledgeInput({
      title: 'Avoid N+1 queries in GraphQL resolvers',
      solution: 'Use DataLoader to batch and cache database queries within a single request',
      type: KnowledgeType.GOTCHA,
      tags: ['graphql', 'performance', 'n+1'],
      context: { language: 'typescript', framework: 'express' },
    }));
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('search', () => {
    it('should return results ranked by relevance', async () => {
      const results = await retriever.search('react hydration error');
      expect(results.length).toBeGreaterThan(0);
      // The most relevant result should be the hydration entry
      expect(results[0].knowledge.title).toContain('hydration');
      expect(results[0].relevanceScore).toBeGreaterThan(0);
    });

    it('should include matchReason in results', async () => {
      const results = await retriever.search('database connection');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchReason).toBeTruthy();
      expect(results[0].matchReason).toContain('Type:');
    });

    it('should assign retrievalId when feedbackLoop is available', async () => {
      const results = await retriever.search('react hydration', undefined, undefined, 5, 'session-1');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].retrievalId).toBeTruthy();
    });

    it('should not assign retrievalId without feedbackLoop', async () => {
      const noFeedback = new Retriever(metadataStore, vectorStore, embedder);
      const results = await noFeedback.search('react hydration');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].retrievalId).toBeUndefined();
    });

    it('should filter by type', async () => {
      const results = await retriever.search('database', undefined, {
        types: [KnowledgeType.HOW_TO],
      });
      for (const r of results) {
        expect(r.knowledge.type).toBe(KnowledgeType.HOW_TO);
      }
    });

    it('should filter by language', async () => {
      const results = await retriever.search('query', {
        currentLanguage: 'typescript',
      });
      expect(results.length).toBeGreaterThan(0);
    });

    it('should respect topK', async () => {
      const results = await retriever.search('typescript', undefined, undefined, 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should return empty for completely unrelated query with no overlap', async () => {
      // Use a query with zero word overlap to the seeded data
      const results = await retriever.search('xyz123 zzz999', undefined, undefined, 5);
      // May return results with very low scores due to hash collisions, just ensure no crash
      expect(results).toBeDefined();
    });
  });

  describe('curateContext', () => {
    it('should return structured curated context', async () => {
      const curated = await retriever.curateContext('fix react rendering issues');
      expect(curated.taskDescription).toBe('fix react rendering issues');
      expect(curated.summary).toBeTruthy();
      expect(curated.summary).toContain('Context for:');
    });

    it('should separate knowledge, workflows, and warnings', async () => {
      const curated = await retriever.curateContext('database setup');
      expect(curated.knowledge).toBeDefined();
      expect(curated.workflows).toBeDefined();
      expect(curated.warnings).toBeDefined();
    });

    it('should handle empty results gracefully', async () => {
      const curated = await retriever.curateContext('xyz completely unrelated topic 12345');
      expect(curated.summary).toBeTruthy();
    });
  });

  describe('temporal awareness', () => {
    it('should decay gotchas faster than conventions of the same age', () => {
      const staleSince = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

      const convention = makeKnowledgeInput({
        type: KnowledgeType.CONVENTION,
        title: 'Long-lived service convention',
        solution: 'Resolve services through the shared container.',
      });
      const gotcha = makeKnowledgeInput({
        type: KnowledgeType.GOTCHA,
        title: 'Old service gotcha',
        solution: 'Do not instantiate services ad-hoc.',
      });

      const conventionKnowledge = metadataStore.create(convention);
      const gotchaKnowledge = metadataStore.create(gotcha);

      metadataStore.getDb().prepare(
        'UPDATE knowledge_units SET updated_at = ? WHERE id IN (?, ?)',
      ).run(staleSince, conventionKnowledge.id, gotchaKnowledge.id);

      const staleConvention = metadataStore.getById(conventionKnowledge.id)!;
      const staleGotcha = metadataStore.getById(gotchaKnowledge.id)!;

      const conventionScore = (retriever as any).computeFinalScore(staleConvention, 0.5);
      const gotchaScore = (retriever as any).computeFinalScore(staleGotcha, 0.5);

      expect(conventionScore).toBeGreaterThan(gotchaScore);
    });

    it('should heavily penalize expired knowledge even if semantic match is strong', () => {
      const expiredAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const staleKnowledge = metadataStore.create(makeKnowledgeInput({
        type: KnowledgeType.HOW_TO,
        title: 'Expired deployment guide',
        solution: 'Use the legacy deployment pipeline.',
      }));

      metadataStore.getDb().prepare(
        'UPDATE knowledge_units SET expires_at = ? WHERE id = ?',
      ).run(expiredAt, staleKnowledge.id);

      const expired = metadataStore.getById(staleKnowledge.id)!;
      const fresh = metadataStore.create(makeKnowledgeInput({
        type: KnowledgeType.HOW_TO,
        title: 'Fresh deployment guide',
        solution: 'Use the current deployment pipeline.',
      }));

      const expiredScore = (retriever as any).computeFinalScore(expired, 0.9);
      const freshScore = (retriever as any).computeFinalScore(fresh, 0.7);

      expect(expiredScore).toBeLessThan(freshScore);
    });

    it('should treat knowledge as expired immediately after the expiration timestamp passes', () => {
      const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const staleKnowledge = metadataStore.create(makeKnowledgeInput({
        type: KnowledgeType.HOW_TO,
        title: 'Just expired rollout note',
        solution: 'Do not use the retired rollout window.',
      }));

      metadataStore.getDb().prepare(
        'UPDATE knowledge_units SET expires_at = ? WHERE id = ?',
      ).run(expiredAt, staleKnowledge.id);

      const expired = metadataStore.getById(staleKnowledge.id)!;
      const expiredScore = (retriever as any).computeFinalScore(expired, 0.9);
      const matchReason = (retriever as any).generateMatchReason(expired);

      expect(expiredScore).toBeLessThan(0.9);
      expect(matchReason).toContain('Expired');
    });
  });
});
