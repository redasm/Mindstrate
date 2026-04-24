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

  it('archives stale low-access episodic nodes and deprecates very low quality nodes', () => {
    const stale = graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Stale episode',
      content: 'Old event',
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

    expect(result.archivedNodes).toBe(1);
    expect(result.deprecatedNodes).toBe(1);
    expect(graphStore.getNodeById(stale.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(weak.id)?.status).toBe(ContextNodeStatus.DEPRECATED);
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

    const result = pruner.prune({ project: 'mindstrate' });

    expect(result.archivedNodes).toBe(1);
    expect(graphStore.getNodeById(snapshot.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(rule.id)?.status).toBe(ContextNodeStatus.ACTIVE);
  });

  it('deprecates nodes whose runtime environment no longer matches the project snapshot', () => {
    const staleRule = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Use old framework API',
      content: 'Use the legacy framework API for routing.',
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

    const result = pruner.prune({ project: 'mindstrate' });

    expect(result.deprecatedNodes).toBe(1);
    expect(graphStore.getNodeById(staleRule.id)?.status).toBe(ContextNodeStatus.DEPRECATED);
  });
});
