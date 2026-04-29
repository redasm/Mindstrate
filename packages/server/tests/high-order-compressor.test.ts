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
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('HighOrderCompressor', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let compressor: HighOrderCompressor;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    compressor = new HighOrderCompressor(graphStore, new Embedder(''));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('upgrades similar rules into skills, heuristics, and axioms', async () => {
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

    for (let index = 0; index < 2; index++) {
      graphStore.createNode({
        substrateType: SubstrateType.SKILL,
        domainType: ContextDomainType.WORKFLOW,
        title: `Skill ${index}`,
        content: 'Apply focused test driven ECS runtime changes.',
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
      });
    }
    const heuristic = await compressor.compressSkillsToHeuristics({ project: 'mindstrate', similarityThreshold: 0.55 });
    expect(heuristic.nodesCreated).toBe(1);
    expect(graphStore.getNodeById(heuristic.clusters[0].targetNodeId)?.substrateType).toBe(SubstrateType.HEURISTIC);

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
    const axiom = await compressor.compressHeuristicsToAxioms({ project: 'mindstrate', similarityThreshold: 0.55 });
    expect(axiom.nodesCreated).toBe(1);
    expect(graphStore.getNodeById(axiom.clusters[0].targetNodeId)?.substrateType).toBe(SubstrateType.AXIOM);

    const outgoing = graphStore.listOutgoingEdges(axiom.clusters[0].sourceNodeIds[0], ContextRelationType.GENERALIZES);
    expect(outgoing.some((edge) => edge.targetId === axiom.clusters[0].targetNodeId)).toBe(true);
  });
});
