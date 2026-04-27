import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { RuleCompressor } from '../src/context-graph/rule-compressor.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('RuleCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: RuleCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new RuleCompressor(graphStore, new Embedder(''));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates a rule node from highly similar patterns', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Pattern A',
      content: 'Abstracted from 2 similar session summaries.\nHydration-safe SSR should avoid browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Pattern B',
      content: 'Abstracted from 3 similar session summaries.\nHydration-safe SSR must avoid browser-only checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const result = await compressor.compressProjectPatterns({
      project: 'mindstrate',
      minClusterSize: 2,
      similarityThreshold: 0.75,
    });

    expect(result.ruleNodesCreated).toBe(1);

    const rules = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      limit: 10,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0].content).toContain('Generalized from 2 highly similar session patterns.');

    const incoming = graphStore.listIncomingEdges(rules[0].id, ContextRelationType.GENERALIZES);
    expect(incoming).toHaveLength(2);
  });

  it('does not recreate rules for patterns that already have a rule parent', async () => {
    const pattern = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Pattern A',
      content: 'Hydration-safe SSR should avoid browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
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
      similarityThreshold: 0.1,
    });

    expect(result.scannedPatterns).toBe(0);
    expect(result.ruleNodesCreated).toBe(0);
  });

  it('promotes highly adopted patterns without waiting for a similarity cluster', async () => {
    const pattern = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Adopted pattern',
      content: 'Repeatedly adopted pattern for hydration-safe SSR rendering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
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
    expect(graphStore.listIncomingEdges(rules[0].id, ContextRelationType.GENERALIZES)).toHaveLength(1);
  });
});
