import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SessionStatus, SubstrateType, ContextRelationType } from '@mindstrate/protocol/models';
import {
  buildSessionSnapshotContent,
  digestCompletedSession,
  buildEpisodeTitle,
  digestSessionObservation,
  sessionObservationToDomainType,
  sessionObservationToEventType,
} from '../src/context-graph/session-digest.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('session digest helpers', () => {
  it('maps observation types to ECS event types', () => {
    expect(sessionObservationToEventType('decision')).toBe('session_observation');
    expect(sessionObservationToEventType('knowledge_applied')).toBe('feedback_signal');
  });

  it('maps observation types to ECS domain types', () => {
    expect(sessionObservationToDomainType('problem_solved')).toBe('bug_fix');
    expect(sessionObservationToDomainType('decision')).toBe('convention');
    expect(sessionObservationToDomainType('progress')).toBe('context_event');
  });

  it('builds readable episode titles', () => {
    expect(buildEpisodeTitle('problem_solved', 'Fixed hydration mismatch')).toContain('problem solved');
  });
});

describe('digestSessionObservation', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates both a context event and an episode node', () => {
    const result = digestSessionObservation({
      graphStore,
      sessionId: 'session-1',
      project: 'mindstrate',
      observation: {
        timestamp: '2026-04-23T03:00:00.000Z',
        type: 'problem_solved',
        content: 'Fixed auth timeout by narrowing test retry scope',
        metadata: { file: 'auth.test.ts' },
      },
    });

    const events = graphStore.listEvents({ project: 'mindstrate' });
    const nodes = graphStore.listNodes({ project: 'mindstrate' });

    expect(result.eventId).toBe(events[0].id);
    expect(result.episodeNodeId).toBe(nodes[0].id);
    expect(events[0].type).toBe('session_observation');
    expect(nodes[0].substrateType).toBe('episode');
    expect(nodes[0].domainType).toBe('bug_fix');
    expect(nodes[0].sourceRef).toBe('session-1');
    expect(graphStore.listOutgoingEdges(nodes[0].id)).toHaveLength(1);
  });

  it('creates a snapshot from a completed session and links source episodes', () => {
    const first = digestSessionObservation({
      graphStore,
      sessionId: 'session-2',
      project: 'mindstrate',
      observation: {
        timestamp: '2026-04-23T03:00:00.000Z',
        type: 'decision',
        content: 'Keep hydration-safe SSR output',
      },
    });
    expect(first.episodeNodeId).toBeTruthy();

    const second = digestSessionObservation({
      graphStore,
      sessionId: 'session-2',
      project: 'mindstrate',
      observation: {
        timestamp: '2026-04-23T03:10:00.000Z',
        type: 'problem_solved',
        content: 'Fixed mismatch by moving browser checks into useEffect',
      },
    });
    expect(second.episodeNodeId).toBeTruthy();

    const snapshot = digestCompletedSession({
      graphStore,
      session: {
        id: 'session-2',
        project: 'mindstrate',
        status: SessionStatus.COMPLETED,
        startedAt: '2026-04-23T02:50:00.000Z',
        endedAt: '2026-04-23T03:20:00.000Z',
        summary: 'Resolved hydration mismatch during SSR.',
        decisions: ['Keep hydration-safe SSR output'],
        problemsSolved: ['Moved browser-only checks into useEffect'],
        openTasks: ['Add regression test'],
        filesModified: ['app/page.tsx'],
      },
    });

    const snapshots = graphStore.listNodes({
      sourceRef: 'session-2',
      substrateType: SubstrateType.SNAPSHOT,
      limit: 10,
    });
    expect(snapshot.snapshotNodeId).toBe(snapshots[0].id);
    expect(snapshots[0].content).toContain('Summary: Resolved hydration mismatch during SSR.');
    expect(snapshots[0].content).toContain('Open Tasks:');

    const episodes = graphStore.listNodes({
      sourceRef: 'session-2',
      substrateType: SubstrateType.EPISODE,
      limit: 10,
    });
    for (const episode of episodes) {
      expect(
        graphStore.listOutgoingEdges(episode.id, ContextRelationType.DERIVED_FROM)
          .some((edge) => edge.targetId === snapshot.snapshotNodeId),
      ).toBe(true);
    }
  });

  it('builds stable snapshot content sections', () => {
    const content = buildSessionSnapshotContent({
      id: 'session-3',
      project: 'mindstrate',
      status: SessionStatus.COMPLETED,
      startedAt: '2026-04-23T00:00:00.000Z',
      summary: 'Completed ECS spike.',
      decisions: ['Use graph storage first'],
      problemsSolved: ['Connected session_save to events'],
      openTasks: ['Create snapshot nodes'],
      filesModified: ['mindstrate.ts'],
    });

    expect(content).toContain('Summary: Completed ECS spike.');
    expect(content).toContain('Decisions:');
    expect(content).toContain('Problems Solved:');
    expect(content).toContain('Open Tasks:');
    expect(content).toContain('Files Modified:');
  });
});
