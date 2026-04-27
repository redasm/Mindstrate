import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { PatternCompressor } from '../src/context-graph/pattern-compressor.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('PatternCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: PatternCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new PatternCompressor(graphStore, new Embedder(''));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates a pattern node from similar summaries', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Summary A',
      content: 'Compressed from 2 similar session snapshots.\nHydration mismatch fixed in SSR rendering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Summary B',
      content: 'Compressed from 3 similar session snapshots.\nHydration mismatch resolved in SSR rendering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const result = await compressor.compressProjectSummaries({
      project: 'mindstrate',
      minClusterSize: 2,
      similarityThreshold: 0.6,
    });

    expect(result.patternNodesCreated).toBe(1);

    const patterns = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      limit: 10,
    });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].content).toContain('Abstracted from 2 similar session summaries.');

    const incoming = graphStore.listIncomingEdges(patterns[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('does not recreate patterns for summaries that already have a pattern parent', async () => {
    const summary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Summary A',
      content: 'Hydration mismatch fixed in SSR rendering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const pattern = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Existing pattern',
      content: 'Existing abstraction.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createEdge({
      sourceId: summary.id,
      targetId: pattern.id,
      relationType: ContextRelationType.GENERALIZES,
      strength: 1,
    });

    const result = await compressor.compressProjectSummaries({
      project: 'mindstrate',
      minClusterSize: 1,
      similarityThreshold: 0.1,
    });

    expect(result.scannedSummaries).toBe(0);
    expect(result.patternNodesCreated).toBe(0);
  });

  it('promotes highly adopted summaries without waiting for a similarity cluster', async () => {
    const summary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Adopted summary',
      content: 'Repeatedly adopted guidance for hydration-safe SSR rendering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.updateNode(summary.id, { positiveFeedback: 4 });

    const result = await compressor.compressProjectSummaries({
      project: 'mindstrate',
      minClusterSize: 2,
      minPositiveFeedback: 3,
    });

    expect(result.patternNodesCreated).toBe(1);
    const patterns = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.PATTERN,
      limit: 10,
    });
    expect(patterns[0].metadata?.['promotionReason']).toBe('high_positive_feedback');
    expect(patterns[0].metadata?.['sourceSummaryIds']).toEqual([summary.id]);
    expect(graphStore.listIncomingEdges(patterns[0].id, ContextRelationType.GENERALIZES)).toHaveLength(1);
  });

  it('promotes summaries repeated across projects as a cross-project pattern', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Web summary',
      content: 'Hydration-safe SSR requires deterministic server and client markup.',
      project: 'web-app',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Admin summary',
      content: 'Hydration-safe SSR needs deterministic client and server markup.',
      project: 'admin-app',
      status: ContextNodeStatus.ACTIVE,
    });

    const result = await compressor.compressProjectSummaries({
      minClusterSize: 2,
      minDistinctProjects: 2,
      similarityThreshold: 0.6,
    });

    expect(result.patternNodesCreated).toBe(1);
    const [pattern] = graphStore.listNodes({
      substrateType: SubstrateType.PATTERN,
      limit: 10,
    });
    expect(pattern.project).toBeUndefined();
    expect(pattern.metadata?.['promotionReason']).toBe('cross_project_validation');
    expect(pattern.metadata?.['sourceProjects']).toEqual(expect.arrayContaining(['web-app', 'admin-app']));
  });
});
