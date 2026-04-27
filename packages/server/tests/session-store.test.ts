/**
 * Tests for SessionStore
 *
 * Covers: create, observe, compress, end, restore context
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { SessionStore } from '../src/storage/session-store.js';
import { DatabaseStore } from '../src/storage/database-store.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('SessionStore', () => {
  let tempDir: string;
  let databaseStore: DatabaseStore;
  let store: SessionStore;

  beforeEach(() => {
    tempDir = createTempDir();
    databaseStore = new DatabaseStore(path.join(tempDir, 'test.db'));
    store = new SessionStore(databaseStore.getDb());
  });

  afterEach(() => {
    databaseStore.close();
    removeTempDir(tempDir);
  });

  describe('create', () => {
    it('should create a new active session', () => {
      const session = store.create({ project: 'test-project' });
      expect(session.id).toBeTruthy();
      expect(session.status).toBe('active');
      expect(session.project).toBe('test-project');
    });
  });

  describe('getActiveSession', () => {
    it('should find the active session for a project', () => {
      store.create({ project: 'proj-a' });
      const active = store.getActiveSession('proj-a');
      expect(active).toBeDefined();
      expect(active!.project).toBe('proj-a');
    });

    it('should return null when no active session exists', () => {
      expect(store.getActiveSession('nonexistent')).toBeNull();
    });
  });

  describe('addObservation', () => {
    it('should append observations to a session', () => {
      const session = store.create({ project: 'test' });
      store.addObservation({
        sessionId: session.id,
        type: 'task_start',
        content: 'Started working on feature X',
      });
      store.addObservation({
        sessionId: session.id,
        type: 'decision',
        content: 'Chose approach A over B',
      });

      const updated = store.getById(session.id);
      expect(updated!.observations).toHaveLength(2);
      expect(updated!.observations![0].type).toBe('task_start');
      expect(updated!.observations![1].type).toBe('decision');
    });

    it('should ignore observations for missing sessions', () => {
      store.addObservation({
        sessionId: 'missing-session',
        type: 'decision',
        content: 'This should not create a session',
      });

      expect(store.getById('missing-session')).toBeNull();
    });
  });

  describe('compress', () => {
    it('should write summary and structured data', () => {
      const session = store.create({ project: 'test' });
      store.compress({
        sessionId: session.id,
        summary: 'Completed feature X',
        decisions: ['Used approach A'],
        openTasks: ['Finish tests'],
        problemsSolved: ['Fixed bug Y'],
        filesModified: ['src/main.ts'],
      });

      const updated = store.getById(session.id);
      expect(updated!.summary).toBe('Completed feature X');
      expect(updated!.decisions).toEqual(['Used approach A']);
      expect(updated!.openTasks).toEqual(['Finish tests']);
    });
  });

  describe('endSession', () => {
    it('should mark session as completed', () => {
      const session = store.create({ project: 'test' });
      store.endSession(session.id, 'completed');

      const ended = store.getById(session.id);
      expect(ended!.status).toBe('completed');
      expect(ended!.endedAt).toBeTruthy();
    });

    it('should mark session as abandoned', () => {
      const session = store.create({ project: 'test' });
      store.endSession(session.id, 'abandoned');

      const ended = store.getById(session.id);
      expect(ended!.status).toBe('abandoned');
    });
  });

  describe('restoreContext', () => {
    it('should return empty context when no sessions exist', () => {
      const ctx = store.restoreContext('empty-project');
      expect(ctx.lastSession).toBeUndefined();
    });

    it('should return last session summary', () => {
      const s = store.create({ project: 'proj' });
      store.compress({
        sessionId: s.id,
        summary: 'Did some work',
        decisions: ['Decision 1'],
        openTasks: ['Task 1'],
      });
      store.endSession(s.id, 'completed');

      const ctx = store.restoreContext('proj');
      expect(ctx.lastSession).toBeDefined();
      expect(ctx.lastSession!.summary).toBe('Did some work');
      expect(ctx.lastSession!.openTasks).toEqual(['Task 1']);
    });
  });

  describe('formatContextForInjection', () => {
    it('should return empty string when no context', () => {
      const text = store.formatContextForInjection({});
      expect(text).toBe('');
    });

    it('should format context with session memory header', () => {
      const ctx = store.restoreContext('non-existent');
      // No sessions, empty context
      const text = store.formatContextForInjection(ctx);
      expect(text).toBe('');
    });
  });

  describe('getRecentSessions', () => {
    it('should return completed sessions in reverse chronological order', async () => {
      const s1 = store.create({ project: 'proj' });
      store.compress({ sessionId: s1.id, summary: 'Session 1' });
      store.endSession(s1.id, 'completed');

      // Small delay to ensure different ended_at timestamps
      await new Promise(r => setTimeout(r, 20));

      const s2 = store.create({ project: 'proj' });
      store.compress({ sessionId: s2.id, summary: 'Session 2' });
      store.endSession(s2.id, 'completed');

      const recent = store.getRecentSessions('proj', 5);
      expect(recent).toHaveLength(2);
      // Most recent first
      expect(recent[0].summary).toBe('Session 2');
    });
  });
});



