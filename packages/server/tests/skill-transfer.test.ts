import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { transferVerifiedSkills } from '../src/skill-evolution/skill-transfer.js';

describe('transferVerifiedSkills', () => {
  let db: Database.Database;
  let graphStore: ContextGraphStore;

  beforeEach(() => {
    db = new Database(':memory:');
    graphStore = new ContextGraphStore(db);
  });

  afterEach(() => {
    db.close();
  });

  const verifiedSkill = (project: string, title: string) =>
    graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title,
      content: `Reusable procedure: ${title}`,
      project,
      status: ContextNodeStatus.VERIFIED,
      confidence: 0.9,
      qualityScore: 90,
    });

  it('copies verified source skills into the target project as candidates', () => {
    const source = verifiedSkill('source-proj', 'Diagnose flaky test');

    const result = transferVerifiedSkills({ graphStore }, { fromProject: 'source-proj', toProject: 'target-proj' });

    expect(result.transferred).toBe(1);
    const copied = graphStore.listNodes({ project: 'target-proj', substrateType: SubstrateType.SKILL });
    expect(copied).toHaveLength(1);
    expect(copied[0].id).not.toBe(source.id);
    expect(copied[0].status).toBe(ContextNodeStatus.CANDIDATE);
    expect(copied[0].project).toBe('target-proj');
    expect(copied[0].metadata?.['transferredFrom']).toBe(source.id);
    expect(copied[0].metadata?.['transferredFromProject']).toBe('source-proj');
  });

  it('skips non-verified and low-order nodes', () => {
    graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: ContextDomainType.WORKFLOW,
      title: 'Active not verified',
      content: 'x',
      project: 'source-proj',
      status: ContextNodeStatus.ACTIVE,
      confidence: 0.9,
      qualityScore: 90,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Verified summary',
      content: 'x',
      project: 'source-proj',
      status: ContextNodeStatus.VERIFIED,
    });

    const result = transferVerifiedSkills({ graphStore }, { fromProject: 'source-proj', toProject: 'target-proj' });

    expect(result.transferred).toBe(0);
    expect(graphStore.listNodes({ project: 'target-proj' })).toHaveLength(0);
  });

  it('is idempotent: re-running does not duplicate transferred skills', () => {
    verifiedSkill('source-proj', 'Diagnose flaky test');

    transferVerifiedSkills({ graphStore }, { fromProject: 'source-proj', toProject: 'target-proj' });
    const second = transferVerifiedSkills({ graphStore }, { fromProject: 'source-proj', toProject: 'target-proj' });

    expect(second.transferred).toBe(0);
    expect(second.skipped).toBe(1);
    expect(graphStore.listNodes({ project: 'target-proj', substrateType: SubstrateType.SKILL })).toHaveLength(1);
  });
});
