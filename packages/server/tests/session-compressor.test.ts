/**
 * Tests for the SessionCompressor
 *
 * Covers: rule-based compression (offline mode)
 */

import { describe, it, expect } from 'vitest';
import { SessionCompressor } from '../src/processing/session-compressor.js';
import { SessionStatus } from '@mindstrate/protocol';
import type { Session, SessionObservation } from '@mindstrate/protocol';

function makeSession(observations: SessionObservation[] = []): Session {
  return {
    id: 'test-session',
    status: SessionStatus.ACTIVE,
    project: 'test-project',
    startedAt: new Date().toISOString(),
    observations,
  };
}

describe('SessionCompressor', () => {
  const compressor = new SessionCompressor(''); // offline mode

  describe('compress (rule-based)', () => {
    it('should produce summary for session with task starts', async () => {
      const session = makeSession([
        { type: 'task_start', content: 'Implement user authentication', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.sessionId).toBe('test-session');
      expect(result.summary).toContain('Worked on');
      expect(result.summary).toContain('user authentication');
    });

    it('should capture decisions', async () => {
      const session = makeSession([
        { type: 'decision', content: 'Use JWT over session cookies', timestamp: new Date().toISOString() },
        { type: 'decision_path', content: 'Chose bcrypt for password hashing', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.decisions).toHaveLength(2);
      expect(result.decisions).toContain('Use JWT over session cookies');
    });

    it('should capture problems solved', async () => {
      const session = makeSession([
        { type: 'problem_solved', content: 'Fixed CORS issue by adding origin whitelist', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.problemsSolved!.length).toBeGreaterThanOrEqual(1);
      expect(result.problemsSolved![0]).toContain('CORS');
    });

    it('should capture failed paths', async () => {
      const session = makeSession([
        { type: 'failed_path', content: 'Tried using passport.js but too complex for this use case', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.problemsSolved!.some(p => p.includes('FAILED APPROACH'))).toBe(true);
    });

    it('should capture file changes', async () => {
      const session = makeSession([
        { type: 'file_change', content: 'src/auth/middleware.ts', timestamp: new Date().toISOString() },
        { type: 'file_change', content: 'src/routes/login.ts', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.filesModified).toHaveLength(2);
    });

    it('should capture open tasks from blockers and progress', async () => {
      const session = makeSession([
        { type: 'blocker', content: 'Need to configure Redis for session storage', timestamp: new Date().toISOString() },
        { type: 'progress', content: 'Started rate limiting implementation', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.openTasks).toHaveLength(2);
    });

    it('should handle empty observations', async () => {
      const session = makeSession([]);
      const result = await compressor.compress(session);
      expect(result.summary).toContain('no significant observations');
    });

    it('should produce comprehensive summary for complex session', async () => {
      const session = makeSession([
        { type: 'task_start', content: 'Add caching layer', timestamp: new Date().toISOString() },
        { type: 'decision', content: 'Use Redis for cache', timestamp: new Date().toISOString() },
        { type: 'problem_solved', content: 'Fixed cache invalidation bug', timestamp: new Date().toISOString() },
        { type: 'insight', content: 'TTL-based expiration works better than event-based', timestamp: new Date().toISOString() },
        { type: 'knowledge_applied', content: 'Used Redis best practices knowledge', timestamp: new Date().toISOString() },
        { type: 'knowledge_rejected', content: 'Memcached guide not applicable', timestamp: new Date().toISOString() },
        { type: 'file_change', content: 'src/cache.ts', timestamp: new Date().toISOString() },
        { type: 'blocker', content: 'Need to optimize for large payloads', timestamp: new Date().toISOString() },
      ]);
      const result = await compressor.compress(session);
      expect(result.summary).toContain('Worked on');
      expect(result.summary).toContain('Solved 1 problem');
      expect(result.summary).toContain('1 decision');
      expect(result.summary).toContain('Key insights');
      expect(result.summary).toContain('Applied 1 knowledge');
      expect(result.summary).toContain('Rejected 1 knowledge');
    });
  });
});
