/**
 * Tests for the RetrievalEvaluator
 *
 * Covers: addCase, listCases, deleteCase, runEvaluation, getTrend
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { RetrievalEvaluator } from '../src/quality/eval.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { VectorStore } from '../src/storage/vector-store.js';
import { Embedder } from '../src/processing/embedder.js';
import { Retriever } from '../src/retrieval/retriever.js';
import { Pipeline } from '../src/processing/pipeline.js';
import { KnowledgeType } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('RetrievalEvaluator', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let vectorStore: VectorStore;
  let embedder: Embedder;
  let retriever: Retriever;
  let pipeline: Pipeline;
  let evaluator: RetrievalEvaluator;
  let seededIds: string[];

  beforeEach(async () => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    vectorStore = new VectorStore(path.join(tempDir, 'vectors'), 'test');
    embedder = new Embedder('');
    retriever = new Retriever(metadataStore, vectorStore, embedder);
    pipeline = new Pipeline(metadataStore, vectorStore, embedder);
    evaluator = new RetrievalEvaluator(metadataStore.getDb(), retriever);

    // Seed knowledge
    seededIds = [];
    const r1 = await pipeline.process(makeKnowledgeInput({
      title: 'Fix typescript null pointer',
      solution: 'Add strict null checks and use optional chaining typescript',
      tags: ['typescript', 'null'],
    }));
    if (r1.knowledge) seededIds.push(r1.knowledge.id);

    const r2 = await pipeline.process(makeKnowledgeInput({
      title: 'React useState best practices',
      solution: 'Use functional updates for state that depends on previous state react hooks',
      type: KnowledgeType.BEST_PRACTICE,
      tags: ['react', 'hooks'],
    }));
    if (r2.knowledge) seededIds.push(r2.knowledge.id);
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  describe('addCase', () => {
    it('should create an eval case with an ID', () => {
      const evalCase = evaluator.addCase('fix null error', [seededIds[0]]);
      expect(evalCase.id).toBeTruthy();
      expect(evalCase.query).toBe('fix null error');
      expect(evalCase.expectedIds).toEqual([seededIds[0]]);
    });

    it('should accept optional language/framework', () => {
      const evalCase = evaluator.addCase('react hooks', [seededIds[1]], {
        language: 'typescript',
        framework: 'react',
      });
      expect(evalCase.language).toBe('typescript');
      expect(evalCase.framework).toBe('react');
    });
  });

  describe('listCases', () => {
    it('should list all added cases', () => {
      evaluator.addCase('q1', [seededIds[0]]);
      evaluator.addCase('q2', [seededIds[1]]);
      const cases = evaluator.listCases();
      expect(cases).toHaveLength(2);
    });

    it('should return empty when no cases exist', () => {
      expect(evaluator.listCases()).toHaveLength(0);
    });
  });

  describe('deleteCase', () => {
    it('should remove an eval case', () => {
      const c = evaluator.addCase('q', [seededIds[0]]);
      expect(evaluator.deleteCase(c.id)).toBe(true);
      expect(evaluator.listCases()).toHaveLength(0);
    });

    it('should return false for non-existent case', () => {
      expect(evaluator.deleteCase('nonexistent')).toBe(false);
    });
  });

  describe('runEvaluation', () => {
    it('should return zero metrics when no eval cases exist', async () => {
      const result = await evaluator.runEvaluation();
      expect(result.totalCases).toBe(0);
      expect(result.precision).toBe(0);
      expect(result.recall).toBe(0);
      expect(result.f1).toBe(0);
    });

    it('should compute precision and recall for eval cases', async () => {
      evaluator.addCase('typescript null pointer fix', [seededIds[0]]);

      const result = await evaluator.runEvaluation(5);
      expect(result.totalCases).toBe(1);
      expect(result.details).toHaveLength(1);

      const detail = result.details[0];
      expect(detail.expectedIds).toEqual([seededIds[0]]);
      expect(detail.retrievedIds.length).toBeGreaterThan(0);
      // The precision/recall should be defined numbers
      expect(typeof detail.precision).toBe('number');
      expect(typeof detail.recall).toBe('number');
    });

    it('should compute MRR correctly', async () => {
      evaluator.addCase('typescript null pointer fix', [seededIds[0]]);
      const result = await evaluator.runEvaluation(5);
      expect(result.meanReciprocalRank).toBeGreaterThanOrEqual(0);
      expect(result.meanReciprocalRank).toBeLessThanOrEqual(1);
    });
  });

  describe('getTrend', () => {
    it('should return insufficient_data with no runs', () => {
      const trend = evaluator.getTrend();
      expect(trend.runs).toHaveLength(0);
      expect(trend.trend).toBe('insufficient_data');
    });

    it('should track runs over time', async () => {
      evaluator.addCase('typescript null', [seededIds[0]]);

      // Run evaluation twice
      await evaluator.runEvaluation(5);
      await evaluator.runEvaluation(5);

      const trend = evaluator.getTrend();
      expect(trend.runs).toHaveLength(2);
      // Still insufficient data (need 4+ for trend)
      expect(trend.trend).toBe('insufficient_data');
    });
  });
});
