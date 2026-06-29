import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { HighOrderCompressor } from '../src/context-graph/high-order-compressor.js';
import { fakeHighOrderProviderFactory } from './high-order-test-support.js';
import { createTempDir, removeTempDir } from './test-support.js';

// All "similar" nodes embed to the same vector so they cluster; the LLM stub
// returns a real synthesis so nodes are actually created.
const SYNTHESIS = JSON.stringify({ related: true, title: 'Synthesized skill', content: 'A generalized principle.' });
const sameVector = () => [1, 0, 0, 0];

describe('HighOrderCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: HighOrderCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new HighOrderCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor: sameVector, chatContent: SYNTHESIS }) as never,
    );
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  const seed = (substrateType: SubstrateType, domainType: ContextDomainType, count = 3) => {
    for (let index = 0; index < count; index++) {
      graphStore.createNode({
        substrateType,
        domainType,
        title: `${substrateType} ${index}`,
        content: `${substrateType} content ${index}`,
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
      });
    }
  };

  it('upgrades similar rules into skills with LLM-synthesized content', async () => {
    seed(SubstrateType.RULE, ContextDomainType.CONVENTION);

    const skill = await compressor.compressRulesToSkills({ project: 'mindstrate' });
    expect(skill.nodesCreated).toBe(1);
    const skillNode = graphStore.getNodeById(skill.clusters[0].targetNodeId);
    expect(skillNode?.substrateType).toBe(SubstrateType.SKILL);
    expect(skillNode?.title).toBe('Synthesized skill');
    expect(skillNode?.content).toBe('A generalized principle.');
    expect(skillNode?.metadata?.llmSynthesized).toBe(true);

    const outgoing = graphStore.listOutgoingEdges(skill.clusters[0].sourceNodeIds[0], ContextRelationType.GENERALIZES);
    expect(outgoing.some((edge) => edge.targetId === skill.clusters[0].targetNodeId)).toBe(true);
  });
});
