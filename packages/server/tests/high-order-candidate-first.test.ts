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
import { createTempDir, removeTempDir } from './test-support.js';

describe('HighOrderCompressor candidate-first promotion', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: HighOrderCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new HighOrderCompressor(graphStore, ProviderFactory.offline());
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates SKILL clusters as candidate nodes, not active', async () => {
    for (let index = 0; index < 2; index++) {
      graphStore.createNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: `Rule ${index}`,
        content: 'Run focused tests before changing ECS runtime behavior.',
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
      });
    }

    const skill = await compressor.compressRulesToSkills({ project: 'mindstrate', similarityThreshold: 0.55 });
    expect(skill.nodesCreated).toBe(1);
    const skillNode = graphStore.getNodeById(skill.clusters[0].targetNodeId);
    expect(skillNode?.substrateType).toBe(SubstrateType.SKILL);
    expect(skillNode?.status).toBe(ContextNodeStatus.CANDIDATE);
  });

  it('does not surface candidate high-order nodes in active-only listings', async () => {
    for (let index = 0; index < 2; index++) {
      graphStore.createNode({
        substrateType: SubstrateType.HEURISTIC,
        domainType: ContextDomainType.BEST_PRACTICE,
        title: `Heuristic ${index}`,
        content: 'Prefer verified changes with evidence before automation.',
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
      });
    }

    await compressor.compressHeuristicsToAxioms({ project: 'mindstrate', similarityThreshold: 0.55 });

    const activeAxioms = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.AXIOM,
      status: ContextNodeStatus.ACTIVE,
    });
    expect(activeAxioms).toHaveLength(0);

    const candidateAxioms = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.AXIOM,
      status: ContextNodeStatus.CANDIDATE,
    });
    expect(candidateAxioms).toHaveLength(1);
  });
});
