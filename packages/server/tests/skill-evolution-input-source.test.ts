import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { FeedbackLoop } from '../src/quality/feedback-loop.js';
import { collectSkillOptimizationTargets } from '../src/skill-evolution/skill-evolution-input-source.js';

describe('collectSkillOptimizationTargets', () => {
  let db: Database.Database;
  let graphStore: ContextGraphStore;
  let feedbackLoop: FeedbackLoop;

  beforeEach(() => {
    db = new Database(':memory:');
    graphStore = new ContextGraphStore(db);
    feedbackLoop = new FeedbackLoop(db);
  });

  afterEach(() => {
    db.close();
  });

  const recordRejections = (nodeId: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const retrievalId = feedbackLoop.trackRetrieval(nodeId, 'q', 'session-x');
      feedbackLoop.recordFeedback(retrievalId, 'rejected');
    }
  };

  it('targets active high-order nodes with low adoption (many rejections)', () => {
    const weak = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Weak skill',
      content: 'Vague guidance that keeps getting rejected.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    recordRejections(weak.id, 6);

    const targets = collectSkillOptimizationTargets({ graphStore, feedbackLoop }, { project: 'mindstrate' });

    expect(targets.map((t) => t.nodeId)).toContain(weak.id);
    expect(targets.find((t) => t.nodeId === weak.id)?.reason).toBe('low_adoption');
  });

  it('does not target low-order substrate nodes', () => {
    const summary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Weak summary',
      content: 'A summary that gets rejected.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    recordRejections(summary.id, 6);

    const targets = collectSkillOptimizationTargets({ graphStore, feedbackLoop }, { project: 'mindstrate' });

    expect(targets.map((t) => t.nodeId)).not.toContain(summary.id);
  });

  it('does not target candidate or archived nodes', () => {
    const candidate = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Candidate skill',
      content: 'Not yet promoted.',
      project: 'mindstrate',
      status: ContextNodeStatus.CANDIDATE,
    });
    recordRejections(candidate.id, 6);

    const targets = collectSkillOptimizationTargets({ graphStore, feedbackLoop }, { project: 'mindstrate' });

    expect(targets.map((t) => t.nodeId)).not.toContain(candidate.id);
  });
});
