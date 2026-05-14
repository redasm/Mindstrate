import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { EvolutionEngine, Pruner } from '../src/metabolism/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('EvolutionEngine', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let engine: EvolutionEngine;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'evolution.db'));
    engine = new EvolutionEngine(graphStore, new Pruner(graphStore));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('generates deterministic evolution suggestions from graph nodes', () => {
    const duplicateA = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Duplicate summary',
      content: 'Keep the graph node contract stable.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
    });
    const duplicateB = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Duplicate summary',
      content: 'Keep the graph node contract stable.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 70,
    });
    const candidate = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.BEST_PRACTICE,
      title: 'Strong candidate',
      content: 'High quality candidate knowledge should become active.',
      project: 'mindstrate',
      status: ContextNodeStatus.CANDIDATE,
      qualityScore: 90,
      confidence: 0.8,
    });
    const weak = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.GOTCHA,
      title: 'Weak pattern',
      content: 'Needs more evidence before it can guide future work.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 50,
      confidence: 0.2,
    });
    const archive = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Archive me',
      content: 'Low quality and low value.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 10,
    });
    const split = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Oversized mixed summary',
      content: `${'# One\n'}${'a'.repeat(900)}\n## Two\n${'b'.repeat(900)}\n### Three\n${'c'.repeat(900)}`,
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 75,
    });

    const result = engine.run({ project: 'mindstrate', maxItems: 20 });

    expect(result.scanned).toBe(6);
    expect(result.summary).toEqual({
      merge: 1,
      improve: 1,
      validate: 1,
      archive: 1,
      split: 1,
    });
    expect(result.autoApplied).toBe(0);
    expect(result.pendingReview).toBe(result.suggestions.length);
    expect(result.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: duplicateA.id,
        type: 'merge',
        relatedIds: [duplicateB.id],
      }),
      expect.objectContaining({ nodeId: candidate.id, type: 'validate' }),
      expect.objectContaining({ nodeId: weak.id, type: 'improve' }),
      expect.objectContaining({ nodeId: archive.id, type: 'archive' }),
      expect.objectContaining({ nodeId: split.id, type: 'split' }),
    ]));
  });

  it('auto-applies safe suggestions and leaves split suggestions for review', () => {
    const primary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Duplicate summary',
      content: 'Keep the graph node contract stable.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
    });
    const duplicate = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Duplicate summary',
      content: 'Keep the graph node contract stable.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 70,
    });
    const candidate = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.BEST_PRACTICE,
      title: 'Strong candidate',
      content: 'High quality candidate knowledge should become active.',
      project: 'mindstrate',
      status: ContextNodeStatus.CANDIDATE,
      qualityScore: 90,
      confidence: 0.8,
    });
    const weak = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.GOTCHA,
      title: 'Weak pattern',
      content: 'Needs more evidence before it can guide future work.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 50,
      confidence: 0.2,
    });
    const archive = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Archive me',
      content: 'Low quality and low value.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 10,
    });
    const split = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Oversized mixed summary',
      content: `${'# One\n'}${'a'.repeat(900)}\n## Two\n${'b'.repeat(900)}\n### Three\n${'c'.repeat(900)}`,
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 75,
    });

    const result = engine.run({ project: 'mindstrate', autoApply: true, maxItems: 20 });

    expect(result.autoApplied).toBe(4);
    expect(result.pendingReview).toBe(1);
    expect(graphStore.getNodeById(duplicate.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(primary.id)?.status).toBe(ContextNodeStatus.ACTIVE);
    expect(graphStore.getNodeById(candidate.id)?.status).toBe(ContextNodeStatus.ACTIVE);
    expect(graphStore.getNodeById(weak.id)?.tags).toContain('needs-improvement');
    expect(graphStore.getNodeById(archive.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(split.id)?.status).toBe(ContextNodeStatus.ACTIVE);
    expect(graphStore.listEdges({
      sourceId: duplicate.id,
      targetId: primary.id,
      relationType: ContextRelationType.GENERALIZES,
    })).toHaveLength(1);
    expect(graphStore.getNodeById(duplicate.id)?.metadata?.['evolutionAudit']).toEqual(expect.objectContaining({
      action: 'merge_duplicate',
      suggestionType: 'merge',
    }));
  });
});
