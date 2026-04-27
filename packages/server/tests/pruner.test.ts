import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { Pruner } from '../src/metabolism/pruner.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('Pruner', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let pruner: Pruner;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'pruner.db'));
    pruner = new Pruner(graphStore);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('suggests stale and weak nodes without changing status by default', () => {
    const stale = graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Stale episode',
      content: 'Stale event',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.updateNode(stale.id, {
      lastAccessedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      accessCount: 0,
    });

    const weak = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Weak summary',
      content: 'Bad guidance',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 10,
    });

    const result = pruner.prune({ project: 'mindstrate' });

    expect(result.archiveCandidates).toContain(stale.id);
    expect(result.deprecateCandidates).toContain(weak.id);
    expect(result.archivedNodes).toBe(0);
    expect(result.deprecatedNodes).toBe(0);
    expect(graphStore.getNodeById(stale.id)?.status).toBe(ContextNodeStatus.ACTIVE);
    expect(graphStore.getNodeById(weak.id)?.status).toBe(ContextNodeStatus.ACTIVE);
  });

  it('applies prune suggestions only when explicitly requested', () => {
    const stale = graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Stale episode',
      content: 'Stale event',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.updateNode(stale.id, {
      lastAccessedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      accessCount: 0,
    });

    const result = pruner.prune({ project: 'mindstrate', apply: true });

    expect(result.archivedNodes).toBe(1);
    expect(result.archiveCandidates).toContain(stale.id);
    expect(graphStore.getNodeById(stale.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
  });

  it('archives lower-level nodes covered by active high-level rules', () => {
    const snapshot = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Repeated TDD reminder',
      content: 'Always write the failing test first for ECS runtime changes.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 75,
    });
    const rule = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'ECS changes are test-first',
      content: 'Write a failing test before changing ECS runtime behavior.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 90,
    });
    graphStore.createEdge({
      sourceId: snapshot.id,
      targetId: rule.id,
      relationType: ContextRelationType.GENERALIZES,
    });

    const result = pruner.prune({ project: 'mindstrate', apply: true });

    expect(result.archivedNodes).toBe(1);
    expect(result.suggestions).toContainEqual(expect.objectContaining({
      nodeId: snapshot.id,
      action: 'archive',
      reason: 'covered_by_high_level_rule',
      evidence: expect.objectContaining({
        ruleId: rule.id,
      }),
    }));
    expect(graphStore.getNodeById(snapshot.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(snapshot.id)?.metadata?.['pruneAudit']).toEqual(expect.objectContaining({
      reason: 'covered_by_high_level_rule',
      evidence: expect.objectContaining({
        ruleId: rule.id,
      }),
    }));
    expect(graphStore.getNodeById(rule.id)?.status).toBe(ContextNodeStatus.ACTIVE);
  });

  it('deprecates nodes whose runtime environment no longer matches the project snapshot', () => {
    const staleRule = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Use previous framework API',
      content: 'Use the previous framework API for routing.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      metadata: {
        framework: 'next@14',
      },
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      title: 'Current project snapshot',
      content: 'Project now runs Next 15.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        framework: 'next@15',
      },
    });

    const result = pruner.prune({ project: 'mindstrate', apply: true });

    expect(result.deprecatedNodes).toBe(1);
    expect(graphStore.getNodeById(staleRule.id)?.status).toBe(ContextNodeStatus.DEPRECATED);
    expect(graphStore.getNodeById(staleRule.id)?.metadata?.['pruneAudit']).toEqual(expect.objectContaining({
      reason: 'project_environment_mismatch',
      evidence: expect.objectContaining({
        framework: expect.objectContaining({
          node: 'next@14',
          project: 'next@15',
        }),
      }),
    }));
  });

  it('supports explicit suggestion mode even when apply thresholds match', () => {
    const weak = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Weak summary',
      content: 'Bad guidance',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 10,
    });

    const result = pruner.prune({ project: 'mindstrate', mode: 'suggest' });

    expect(result.deprecatedNodes).toBe(0);
    expect(result.deprecateCandidates).toContain(weak.id);
    expect(result.suggestions[0]).toEqual(expect.objectContaining({
      nodeId: weak.id,
      action: 'deprecate',
      reason: 'low_quality_or_negative_feedback',
    }));
    expect(graphStore.getNodeById(weak.id)?.status).toBe(ContextNodeStatus.ACTIVE);
  });

  it('does not suggest pinned, critical, or verified nodes for pruning', () => {
    const critical = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Critical historical summary',
      content: 'Rare but important release recovery guidance.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 10,
      metadata: { critical: true },
    });

    const result = pruner.prune({ project: 'mindstrate' });

    expect(result.archiveCandidates).not.toContain(critical.id);
    expect(result.deprecateCandidates).not.toContain(critical.id);
    expect(graphStore.getNodeById(critical.id)?.status).toBe(ContextNodeStatus.ACTIVE);
  });
});
