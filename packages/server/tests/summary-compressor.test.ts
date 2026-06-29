import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SummaryCompressor } from '../src/context-graph/summary-compressor.js';
import { ProviderFactory } from '../src/processing/provider-factory.js';
import { fakeHighOrderProviderFactory } from './high-order-test-support.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

// Snapshots mentioning "hydration" embed to one vector (so they cluster);
// everything else embeds elsewhere. The LLM stub returns a real synthesis so
// the cluster actually becomes a SUMMARY.
const SYNTHESIS = JSON.stringify({ related: true, title: 'Synthesized summary', content: 'A real summary body.' });
const vectorFor = (text: string) => (text.includes('hydration') ? [1, 0, 0, 0] : [0, 1, 0, 0]);

describe('SummaryCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: SummaryCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new SummaryCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: SYNTHESIS }) as never,
    );
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  const seedSnapshot = (title: string, content: string, extra: Record<string, unknown> = {}) =>
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title,
      content,
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      ...extra,
    });

  it('creates an LLM-synthesized summary node from similar snapshots', async () => {
    seedSnapshot('Session snapshot A', 'Summary: Fixed hydration mismatch in SSR rendering flow.');
    seedSnapshot('Session snapshot B', 'Summary: Resolved hydration mismatch in SSR rendering path.');
    seedSnapshot('Unrelated snapshot', 'Summary: PostgreSQL connection pool tuning.');

    const result = await compressor.compressProjectSnapshots({
      project: 'mindstrate',
      minClusterSize: 2,
    });

    expect(result.summaryNodesCreated).toBe(1);

    const summaries = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: 10,
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].title).toBe('Synthesized summary');
    expect(summaries[0].content).toBe('A real summary body.');
    expect(summaries[0].metadata?.llmSynthesized).toBe(true);

    const incoming = graphStore.listIncomingEdges(summaries[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('skips a cluster the LLM judges unrelated (no template shell written)', async () => {
    const noSynth = new SummaryCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: JSON.stringify({ related: false }) }) as never,
    );
    seedSnapshot('Session snapshot A', 'Summary: Fixed hydration mismatch in SSR rendering flow.');
    seedSnapshot('Session snapshot B', 'Summary: Resolved hydration mismatch in SSR rendering path.');

    const result = await noSynth.compressProjectSnapshots({ project: 'mindstrate', minClusterSize: 2 });

    expect(result.summaryNodesCreated).toBe(0);
    expect(graphStore.listNodes({ project: 'mindstrate', substrateType: SubstrateType.SUMMARY, limit: 10 })).toHaveLength(0);
  });

  it('produces nothing when there is no LLM (offline)', async () => {
    compressor = new SummaryCompressor(graphStore, ProviderFactory.offline());
    seedSnapshot('Session snapshot A', 'Summary: hydration mismatch.', { qualityScore: 90 });
    seedSnapshot('Session snapshot B', 'Summary: hydration mismatch again.', { qualityScore: 90 });

    const result = await compressor.compressProjectSnapshots({ project: 'mindstrate' });

    expect(result.scannedSnapshots).toBe(0);
    expect(result.summaryNodesCreated).toBe(0);
  });

  it('does not recreate summaries for snapshots that already have a summary parent', async () => {
    const snapshot = seedSnapshot('Session snapshot A', 'Summary: Fixed hydration mismatch in SSR rendering flow.');
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
    });

    expect(result.scannedSnapshots).toBe(0);
    expect(result.summaryNodesCreated).toBe(0);
  });

  it('promotes a single quality-verified snapshot into an LLM-refined SUMMARY', async () => {
    seedSnapshot(
      'Lone session snapshot',
      'Summary: discovered before-edit hydration path-matching regression and fixed it.',
      { qualityScore: 75, confidence: 0.85 },
    );

    const result = await compressor.compressProjectSnapshots({ project: 'mindstrate' });

    expect(result.summaryNodesCreated).toBe(1);
    const summaries = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: 10,
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].metadata?.llmSynthesized).toBe(true);
  });

  it('does NOT promote a low-quality singleton', async () => {
    seedSnapshot('Scratch snapshot', 'Summary: half-finished hydration thought.', { qualityScore: 40, confidence: 0.5 });

    const result = await compressor.compressProjectSnapshots({ project: 'mindstrate' });

    expect(result.summaryNodesCreated).toBe(0);
  });
});
