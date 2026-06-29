import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { HighOrderCompressor } from '../src/context-graph/high-order-compressor.js';
import { ProviderFactory } from '../src/processing/provider-factory.js';
import { fakeHighOrderProviderFactory } from './high-order-test-support.js';
import { createTempDir, removeTempDir } from './test-support.js';

const SYNTHESIS = JSON.stringify({ related: true, title: 'Synth', content: 'Generalized.' });
const sameVector = () => [1, 0, 0, 0];

describe('HighOrderCompressor candidate-first promotion', () => {
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

  const seed = (substrateType: SubstrateType, domainType: ContextDomainType) => {
    for (let index = 0; index < 3; index++) {
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

  it('creates SKILL clusters as candidate nodes, not active', async () => {
    seed(SubstrateType.RULE, ContextDomainType.CONVENTION);
    const skill = await compressor.compressRulesToSkills({ project: 'mindstrate' });
    expect(skill.nodesCreated).toBe(1);
    const skillNode = graphStore.getNodeById(skill.clusters[0].targetNodeId);
    expect(skillNode?.substrateType).toBe(SubstrateType.SKILL);
    expect(skillNode?.status).toBe(ContextNodeStatus.CANDIDATE);
  });

  it('skips high-order compression entirely in offline (hash) mode', async () => {
    seed(SubstrateType.RULE, ContextDomainType.CONVENTION);
    const offline = new HighOrderCompressor(graphStore, ProviderFactory.offline());
    const skill = await offline.compressRulesToSkills({ project: 'mindstrate' });
    expect(skill.nodesCreated).toBe(0);
    expect(graphStore.listNodes({ project: 'mindstrate', substrateType: SubstrateType.SKILL })).toHaveLength(0);
  });

  it('skips a cluster when the LLM declines to synthesize', async () => {
    seed(SubstrateType.RULE, ContextDomainType.CONVENTION);
    const noSynth = new HighOrderCompressor(
      graphStore,
      fakeHighOrderProviderFactory({ vectorFor: sameVector, chatContent: JSON.stringify({ related: false }) }) as never,
    );
    const skill = await noSynth.compressRulesToSkills({ project: 'mindstrate' });
    expect(skill.nodesCreated).toBe(0);
  });
});
