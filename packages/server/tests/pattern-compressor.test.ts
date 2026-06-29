import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { PatternCompressor } from '../src/context-graph/pattern-compressor.js';
import { ProviderFactory } from '../src/processing/provider-factory.js';
import { fakeHighOrderProviderFactory } from './high-order-test-support.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

const SYNTHESIS = JSON.stringify({ related: true, title: 'Synthesized pattern', content: 'A real pattern body.' });
const vectorFor = (text: string) => (text.includes('hydration') ? [1, 0, 0, 0] : [0, 1, 0, 0]);

describe('PatternCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: PatternCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new PatternCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: SYNTHESIS }) as never,
    );
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  const seedSummary = (title: string, content: string, project = 'mindstrate') =>
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title,
      content,
      project,
      status: ContextNodeStatus.ACTIVE,
    });

  it('creates an LLM-synthesized pattern node from similar summaries', async () => {
    seedSummary('Summary A', 'Hydration mismatch fixed in SSR rendering.');
    seedSummary('Summary B', 'Hydration mismatch resolved in SSR rendering.');

    const result = await compressor.compressProjectSummaries({
      project: 'mindstrate',
      minClusterSize: 2,
    });

    expect(result.patternNodesCreated).toBe(1);

    const patterns = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      limit: 10,
    });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].title).toBe('Synthesized pattern');
    expect(patterns[0].content).toBe('A real pattern body.');
    expect(patterns[0].metadata?.llmSynthesized).toBe(true);

    const incoming = graphStore.listIncomingEdges(patterns[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('skips a cluster the LLM judges unrelated (no template shell written)', async () => {
    const noSynth = new PatternCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: JSON.stringify({ related: false }) }) as never,
    );
    seedSummary('Summary A', 'Hydration mismatch fixed in SSR rendering.');
    seedSummary('Summary B', 'Hydration mismatch resolved in SSR rendering.');

    const result = await noSynth.compressProjectSummaries({ project: 'mindstrate', minClusterSize: 2 });

    expect(result.patternNodesCreated).toBe(0);
    expect(graphStore.listNodes({ project: 'mindstrate', substrateType: SubstrateType.PATTERN, limit: 10 })).toHaveLength(0);
  });

  it('produces nothing when there is no LLM (offline)', async () => {
    compressor = new PatternCompressor(graphStore, ProviderFactory.offline());
    const s = seedSummary('Adopted summary', 'Repeatedly adopted hydration-safe SSR guidance.');
    graphStore.updateNode(s.id, { positiveFeedback: 4 });

    const result = await compressor.compressProjectSummaries({ project: 'mindstrate' });

    expect(result.scannedSummaries).toBe(0);
    expect(result.patternNodesCreated).toBe(0);
  });

  it('does not recreate patterns for summaries that already have a pattern parent', async () => {
    const summary = seedSummary('Summary A', 'Hydration mismatch fixed in SSR rendering.');
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
    });

    expect(result.scannedSummaries).toBe(0);
    expect(result.patternNodesCreated).toBe(0);
  });

  it('promotes a highly adopted singleton summary into an LLM-refined pattern', async () => {
    const summary = seedSummary('Adopted summary', 'Repeatedly adopted hydration-safe SSR guidance.');
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
    expect(patterns[0].metadata?.llmSynthesized).toBe(true);
    expect(graphStore.listIncomingEdges(patterns[0].id, ContextRelationType.GENERALIZES)).toHaveLength(1);
  });

  it('promotes summaries repeated across projects as a cross-project pattern', async () => {
    seedSummary('Web summary', 'Hydration-safe SSR requires deterministic server and client markup.', 'web-app');
    seedSummary('Admin summary', 'Hydration-safe SSR needs deterministic client and server markup.', 'admin-app');

    const result = await compressor.compressProjectSummaries({
      minClusterSize: 2,
      minDistinctProjects: 2,
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
