import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { RuleCompressor } from '../src/context-graph/rule-compressor.js';
import { ProviderFactory } from '../src/processing/provider-factory.js';
import { fakeHighOrderProviderFactory } from './high-order-test-support.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

const SYNTHESIS = JSON.stringify({ related: true, title: 'Synthesized rule', content: 'A real rule body.' });
const vectorFor = (text: string) => (text.includes('hydration') ? [1, 0, 0, 0] : [0, 1, 0, 0]);

describe('RuleCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: RuleCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new RuleCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: SYNTHESIS }) as never,
    );
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  const seedPattern = (title: string, content: string, extra: Record<string, unknown> = {}) =>
    graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title,
      content,
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      ...extra,
    });

  it('creates an LLM-synthesized rule node from highly similar patterns', async () => {
    seedPattern('Pattern A', 'Hydration-safe SSR should avoid browser checks during render.');
    seedPattern('Pattern B', 'Hydration-safe SSR must avoid browser-only checks during render.');

    const result = await compressor.compressProjectPatterns({
      project: 'mindstrate',
      minClusterSize: 2,
    });

    expect(result.ruleNodesCreated).toBe(1);

    const rules = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      limit: 10,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].title).toBe('Synthesized rule');
    expect(rules[0].content).toBe('A real rule body.');
    expect(rules[0].metadata?.llmSynthesized).toBe(true);

    const incoming = graphStore.listIncomingEdges(rules[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('skips a cluster the LLM judges unrelated (no template shell written)', async () => {
    const noSynth = new RuleCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor, chatContent: JSON.stringify({ related: false }) }) as never,
    );
    seedPattern('Pattern A', 'Hydration-safe SSR should avoid browser checks during render.');
    seedPattern('Pattern B', 'Hydration-safe SSR must avoid browser-only checks during render.');

    const result = await noSynth.compressProjectPatterns({ project: 'mindstrate', minClusterSize: 2 });

    expect(result.ruleNodesCreated).toBe(0);
    expect(graphStore.listNodes({ project: 'mindstrate', substrateType: SubstrateType.RULE, limit: 10 })).toHaveLength(0);
  });

  it('produces nothing when there is no LLM (offline)', async () => {
    compressor = new RuleCompressor(graphStore, ProviderFactory.offline());
    const p = seedPattern('Adopted pattern', 'Repeatedly adopted hydration-safe SSR rendering pattern.');
    graphStore.updateNode(p.id, { positiveFeedback: 5 });

    const result = await compressor.compressProjectPatterns({ project: 'mindstrate' });

    expect(result.scannedPatterns).toBe(0);
    expect(result.ruleNodesCreated).toBe(0);
  });

  it('does not recreate rules for patterns that already have a rule parent', async () => {
    const pattern = seedPattern('Pattern A', 'Hydration-safe SSR should avoid browser checks during render.');
    const rule = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Existing rule',
      content: 'Existing generalization.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createEdge({
      sourceId: pattern.id,
      targetId: rule.id,
      relationType: ContextRelationType.GENERALIZES,
      strength: 1,
    });

    const result = await compressor.compressProjectPatterns({
      project: 'mindstrate',
      minClusterSize: 1,
    });

    expect(result.scannedPatterns).toBe(0);
    expect(result.ruleNodesCreated).toBe(0);
  });

  it('promotes a highly adopted singleton pattern into an LLM-refined rule', async () => {
    const pattern = seedPattern('Adopted pattern', 'Repeatedly adopted hydration-safe SSR rendering pattern.');
    graphStore.updateNode(pattern.id, { positiveFeedback: 5 });

    const result = await compressor.compressProjectPatterns({
      project: 'mindstrate',
      minClusterSize: 2,
      minPositiveFeedback: 4,
    });

    expect(result.ruleNodesCreated).toBe(1);
    const rules = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      limit: 10,
    });
    expect(rules[0].metadata?.['promotionReason']).toBe('high_positive_feedback');
    expect(rules[0].metadata?.['sourcePatternIds']).toEqual([pattern.id]);
    expect(rules[0].metadata?.llmSynthesized).toBe(true);
    expect(graphStore.listIncomingEdges(rules[0].id, ContextRelationType.GENERALIZES)).toHaveLength(1);
  });
});
