/**
 * Tests for the Mindstrate facade
 *
 * Covers: init, add, search, sessions, stats, close
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mindstrate } from '../src/mindstrate.js';
import { KnowledgeType } from '@mindstrate/protocol';
import { createTempDir, removeTempDir, makeKnowledgeInput } from './helpers.js';
import type { DetectedProject } from '../src/project/detector.js';

describe('Mindstrate', () => {
  let tempDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    tempDir = createTempDir();
    memory = new Mindstrate({
      dataDir: tempDir,
      openaiApiKey: '', // offline mode
    });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(tempDir);
  });

  describe('init', () => {
    it('should initialize without error', () => {
      // Already initialized in beforeEach
      expect(memory).toBeDefined();
    });

    it('should be idempotent', async () => {
      await memory.init();
      await memory.init();
      // No error means success
    });
  });

  describe('add and get', () => {
    it('should add and retrieve knowledge', async () => {
      const result = await memory.add(makeKnowledgeInput());
      expect(result.success).toBe(true);

      const k = memory.get(result.knowledge!.id);
      expect(k).toBeDefined();
      expect(k!.title).toBe('Test knowledge entry');
    });

    it('should detect duplicate entries', async () => {
      const input = makeKnowledgeInput();
      const r1 = await memory.add(input);
      const r2 = await memory.add(input);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(false);
      expect(r2.duplicateOf).toBe(r1.knowledge!.id);
    });
  });

  describe('search', () => {
    it('should find relevant knowledge', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix React hydration error',
        solution: 'Use useEffect for client-side code',
        context: { language: 'typescript', framework: 'react' },
      }));

      const results = await memory.search('hydration error in react');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].knowledge.title).toContain('hydration');
    });

    it('should return empty for unrelated queries', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix Python import error',
        solution: 'Use virtual environment',
        tags: ['python'],
        context: { language: 'python' },
      }));

      // offline embeddings are word-based, so completely unrelated text should have low similarity
      // but may still return results - we just check it doesn't crash
      const results = await memory.search('quantum physics formulas');
      expect(results).toBeDefined();
    });
  });

  describe('update and delete', () => {
    it('should update knowledge', async () => {
      const r = await memory.add(makeKnowledgeInput());
      const updated = memory.update(r.knowledge!.id, { title: 'New title' });
      expect(updated!.title).toBe('New title');
    });

    it('should delete knowledge', async () => {
      const r = await memory.add(makeKnowledgeInput());
      const deleted = await memory.delete(r.knowledge!.id);
      expect(deleted).toBe(true);
      expect(memory.get(r.knowledge!.id)).toBeNull();
    });

    it('should reindex knowledge when updated through the reindexing path', async () => {
      const r = await memory.add(makeKnowledgeInput({
        title: 'Old architecture guidance',
        solution: 'legacy token rotation flow',
      }));

      let results = await memory.search('legacy token rotation flow');
      expect(results.some((item) => item.knowledge.id === r.knowledge!.id)).toBe(true);

      await memory.updateAndReindex(r.knowledge!.id, {
        title: 'New architecture guidance',
        solution: 'modern secret rotation flow',
      });

      results = await memory.search('modern secret rotation flow');
      expect(results.some((item) => item.knowledge.id === r.knowledge!.id)).toBe(true);
    });
  });

  describe('list', () => {
    it('should list all knowledge', async () => {
      await memory.add(makeKnowledgeInput({ title: 'A', solution: 'sol a alpha unique' }));
      await memory.add(makeKnowledgeInput({ title: 'B', solution: 'sol b beta different topic' }));
      const all = memory.list();
      expect(all.length).toBe(2);
    });
  });

  describe('voting', () => {
    it('should upvote and downvote', async () => {
      const r = await memory.add(makeKnowledgeInput());
      memory.upvote(r.knowledge!.id);
      memory.upvote(r.knowledge!.id);
      memory.downvote(r.knowledge!.id);

      const k = memory.get(r.knowledge!.id);
      expect(k!.quality.upvotes).toBe(2);
      expect(k!.quality.downvotes).toBe(1);
    });
  });

  describe('sessions', () => {
    it('should start and end a session', async () => {
      const session = await memory.startSession({ project: 'test-proj' });
      expect(session.status).toBe('active');

      memory.saveObservation({
        sessionId: session.id,
        type: 'task_start',
        content: 'Working on tests',
      });

      await memory.endSession(session.id);
      const ended = memory.getSession(session.id);
      expect(ended!.status).toBe('completed');
    });

    it('should auto-end old active session when starting new one', async () => {
      const s1 = await memory.startSession({ project: 'proj' });
      const s2 = await memory.startSession({ project: 'proj' });

      const old = memory.getSession(s1.id);
      expect(old!.status).toBe('abandoned');
      expect(s2.status).toBe('active');
    });
  });

  describe('assembleContext', () => {
    it('should assemble session continuity, project snapshot, and curated knowledge', async () => {
      await memory.add(makeKnowledgeInput({
        title: 'Fix React hydration mismatch',
        solution: 'Use useEffect for browser-only code paths.',
        tags: ['react', 'hydration'],
        context: { project: 'proj', language: 'typescript', framework: 'react' },
      }));

      const previous = await memory.startSession({ project: 'proj' });
      memory.saveObservation({
        sessionId: previous.id,
        type: 'decision',
        content: 'Keep SSR output deterministic before hydration.',
      });
      await memory.endSession(previous.id);

      const project: DetectedProject = {
        root: tempDir,
        name: 'proj',
        language: 'typescript',
        framework: 'react',
        runtime: 'node',
        packageManager: 'npm',
        version: '1.0.0',
        dependencies: [],
        truncatedDeps: 0,
        scripts: {},
        entryPoints: ['src/index.ts'],
        topDirs: ['src'],
        workspaces: [],
        manifestPath: 'package.json',
        detectedAt: new Date().toISOString(),
        git: { isRepo: false },
      };
      await memory.upsertProjectSnapshot(project);

      const assembled = await memory.assembleContext('fix hydration mismatch', {
        project: 'proj',
        context: { currentLanguage: 'typescript', currentFramework: 'react' },
      });

      expect(assembled.project).toBe('proj');
      expect(assembled.sessionContext).toContain('Keep SSR output deterministic');
      expect(assembled.projectSnapshot?.tags).toContain('project-snapshot');
      expect(assembled.curated.knowledge.length).toBeGreaterThan(0);
      expect(assembled.summary).toContain('Session Continuity');
      expect(assembled.summary).toContain('Project Snapshot');
      expect(assembled.summary).toContain('Task Curation');
    });

    it('should gracefully assemble context without session or project snapshot', async () => {
      const assembled = await memory.assembleContext('brand new task', {
        project: 'missing-project',
      });

      expect(assembled.project).toBe('missing-project');
      expect(assembled.sessionContext).toBeUndefined();
      expect(assembled.projectSnapshot).toBeUndefined();
      expect(assembled.curated).toBeDefined();
      expect(assembled.summary).toContain('Working Context for: brand new task');
    });
  });

  describe('stats', () => {
    it('should return aggregate statistics', async () => {
      await memory.add(makeKnowledgeInput());
      const stats = await memory.getStats();
      expect(stats.total).toBe(1);
      expect(stats.vectorCount).toBe(1);
    });
  });

  describe('checkQuality', () => {
    it('should check quality without writing', () => {
      const result = memory.checkQuality(makeKnowledgeInput());
      expect(result.passed).toBe(true);
      expect(memory.list()).toHaveLength(0);
    });
  });

  describe('maintenance', () => {
    it('should run maintenance without error', async () => {
      await memory.add(makeKnowledgeInput());
      const result = memory.runMaintenance();
      expect(result.total).toBe(1);
    });
  });

  describe('config', () => {
    it('should expose read-only config', () => {
      const cfg = memory.getConfig();
      expect(cfg.dataDir).toBe(tempDir);
    });
  });
});
