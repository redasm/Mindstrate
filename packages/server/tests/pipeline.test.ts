/**
 * Tests for the Processing Pipeline
 *
 * Covers: quality gate, normalization, dedup detection, contradiction check, full process flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { Pipeline } from '../src/processing/pipeline.js';
import { MetadataStore } from '../src/storage/metadata-store.js';
import { VectorStore } from '../src/storage/vector-store.js';
import { Embedder } from '../src/processing/embedder.js';
import { KnowledgeType } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';

describe('Pipeline', () => {
  let tempDir: string;
  let metadataStore: MetadataStore;
  let vectorStore: VectorStore;
  let embedder: Embedder;
  let pipeline: Pipeline;

  beforeEach(() => {
    tempDir = createTempDir();
    metadataStore = new MetadataStore(path.join(tempDir, 'test.db'));
    vectorStore = new VectorStore(path.join(tempDir, 'vectors'), 'test');
    embedder = new Embedder(''); // offline mode
    pipeline = new Pipeline(metadataStore, vectorStore, embedder, 0.92);
  });

  afterEach(() => {
    metadataStore.close();
    removeTempDir(tempDir);
  });

  // ==============================================================
  // Quality Gate
  // ==============================================================

  describe('qualityGate', () => {
    it('should pass for a well-formed input', () => {
      const input = makeKnowledgeInput();
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.completenessScore).toBeGreaterThan(50);
    });

    it('should fail when title is missing', () => {
      const input = makeKnowledgeInput({ title: '' });
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Title is required and cannot be empty');
    });

    it('should fail when solution is missing', () => {
      const input = makeKnowledgeInput({ solution: '' });
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Solution is required and cannot be empty');
    });

    it('should fail when type is missing', () => {
      const input = makeKnowledgeInput({ type: undefined });
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(false);
    });

    it('should warn for bug_fix without problem description', () => {
      const input = makeKnowledgeInput({ problem: undefined });
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(true);
      expect(result.warnings.some(w => w.includes('problem description'))).toBe(true);
    });

    it('should warn when no tags are provided', () => {
      const input = makeKnowledgeInput({ tags: [] });
      const result = pipeline.qualityGate(input);
      expect(result.passed).toBe(true);
      expect(result.warnings.some(w => w.includes('tags'))).toBe(true);
    });

    it('should give higher score for inputs with actionable guidance', () => {
      const plain = makeKnowledgeInput();
      const withGuide = makeKnowledgeInput({
        actionable: {
          preconditions: ['Node >= 18'],
          steps: ['Step 1', 'Step 2'],
          verification: 'Run npm test',
        },
      });
      const scorePlain = pipeline.qualityGate(plain).completenessScore;
      const scoreGuide = pipeline.qualityGate(withGuide).completenessScore;
      expect(scoreGuide).toBeGreaterThan(scorePlain);
    });

    it('should warn for workflow type without steps', () => {
      const input = makeKnowledgeInput({ type: KnowledgeType.WORKFLOW });
      const result = pipeline.qualityGate(input);
      expect(result.warnings.some(w => w.includes('actionable steps'))).toBe(true);
    });
  });

  // ==============================================================
  // Full Process
  // ==============================================================

  describe('process', () => {
    it('should successfully add a new knowledge entry', async () => {
      const input = makeKnowledgeInput();
      const result = await pipeline.process(input);
      expect(result.success).toBe(true);
      expect(result.knowledge).toBeDefined();
      expect(result.knowledge!.id).toBeTruthy();
      expect(result.knowledge!.title).toBe('Test knowledge entry');
    });

    it('should detect duplicates', async () => {
      const input = makeKnowledgeInput();
      const first = await pipeline.process(input);
      expect(first.success).toBe(true);

      // Same content should be detected as duplicate
      const second = await pipeline.process(input);
      expect(second.success).toBe(false);
      expect(second.duplicateOf).toBe(first.knowledge!.id);
    });

    it('should normalize tags to lowercase', async () => {
      const input = makeKnowledgeInput({ tags: ['TypeScript', 'REACT', '  spaced  '] });
      const result = await pipeline.process(input);
      expect(result.success).toBe(true);
      expect(result.knowledge!.tags).toEqual(['typescript', 'react', 'spaced']);
    });

    it('should normalize language to lowercase', async () => {
      const input = makeKnowledgeInput({
        context: { language: 'TypeScript', framework: 'Express' },
      });
      const result = await pipeline.process(input);
      expect(result.success).toBe(true);
      expect(result.knowledge!.context.language).toBe('typescript');
      expect(result.knowledge!.context.framework).toBe('express');
    });

    it('should reject entries that fail quality gate', async () => {
      const input = makeKnowledgeInput({ title: '', solution: '' });
      const result = await pipeline.process(input);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Quality gate failed');
    });

    it('should add different knowledge entries without conflict', async () => {
      const input1 = makeKnowledgeInput({ title: 'First entry', solution: 'Solution A for problem alpha' });
      const input2 = makeKnowledgeInput({ title: 'Second entry', solution: 'Solution B for problem beta completely different topic' });

      const r1 = await pipeline.process(input1);
      const r2 = await pipeline.process(input2);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.knowledge!.id).not.toBe(r2.knowledge!.id);
    });
  });
});
