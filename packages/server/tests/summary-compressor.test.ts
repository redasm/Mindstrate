import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SummaryCompressor } from '../src/context-graph/summary-compressor.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('SummaryCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: SummaryCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new SummaryCompressor(graphStore, new Embedder(''));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates a summary node from similar snapshots', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot A',
      content: 'Summary: Fixed hydration mismatch in SSR rendering flow.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot B',
      content: 'Summary: Resolved hydration mismatch in SSR rendering path.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Unrelated snapshot',
      content: 'Summary: PostgreSQL connection pool tuning.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const result = await compressor.compressProjectSnapshots({
      project: 'mindstrate',
      minClusterSize: 2,
      similarityThreshold: 0.6,
    });

    expect(result.summaryNodesCreated).toBe(1);

    const summaries = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: 10,
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].content).toContain('Compressed from 2 similar session snapshots.');

    const incoming = graphStore.listIncomingEdges(summaries[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('does not recreate summaries for snapshots that already have a summary parent', async () => {
    const snapshot = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot A',
      content: 'Summary: Fixed hydration mismatch in SSR rendering flow.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const summary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Existing summary',
      content: 'Already summarized.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createEdge({
      sourceId: snapshot.id,
      targetId: summary.id,
      relationType: ContextRelationType.GENERALIZES,
      strength: 1,
    });

    const result = await compressor.compressProjectSnapshots({
      project: 'mindstrate',
      minClusterSize: 1,
      similarityThreshold: 0.1,
    });

    expect(result.scannedSnapshots).toBe(0);
    expect(result.summaryNodesCreated).toBe(0);
  });
});
