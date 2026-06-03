import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextNodeStatus,
  SkillEvolutionPatchOperation,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SkillEvolutionStore } from '../src/skill-evolution/skill-evolution-store.js';
import { synthesizeMetaSkill } from '../src/skill-evolution/meta-skill-synthesizer.js';

describe('synthesizeMetaSkill', () => {
  let db: Database.Database;
  let graphStore: ContextGraphStore;
  let evolutionStore: SkillEvolutionStore;

  beforeEach(() => {
    db = new Database(':memory:');
    graphStore = new ContextGraphStore(db);
    evolutionStore = new SkillEvolutionStore(db);
  });

  afterEach(() => {
    db.close();
  });

  const acceptedPatch = (rationale: string) => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SKILL,
      domainType: 'workflow' as never,
      title: 'Skill',
      content: 'content',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const patch = evolutionStore.createPatch({
      project: 'mindstrate',
      sourceNodeId: node.id,
      operation: SkillEvolutionPatchOperation.ADD,
      beforeContent: 'before',
      afterContent: 'before\nafter',
      rationale,
      budget: { maxChangedBullets: 1, maxChangedTokens: 5 },
    });
    evolutionStore.markPatchAccepted(patch.id, {});
    return patch;
  };

  it('returns null when there are not enough accepted patches', () => {
    acceptedPatch('Add evidence ids.');
    const result = synthesizeMetaSkill({ graphStore, evolutionStore }, { project: 'mindstrate', minAcceptedPatches: 3 });
    expect(result).toBeNull();
  });

  it('synthesizes a candidate HEURISTIC meta-skill from accepted patches', () => {
    acceptedPatch('Add evaluation evidence ids to skills.');
    acceptedPatch('Tighten vague guidance into bounded steps.');
    acceptedPatch('Add verification step before accepting changes.');

    const result = synthesizeMetaSkill({ graphStore, evolutionStore }, { project: 'mindstrate', minAcceptedPatches: 3 });

    expect(result).not.toBeNull();
    const node = graphStore.getNodeById(result!.nodeId);
    expect(node?.substrateType).toBe(SubstrateType.HEURISTIC);
    expect(node?.status).toBe(ContextNodeStatus.CANDIDATE);
    expect(node?.content).toContain('Add evaluation evidence ids');
    expect(node?.metadata?.['metaSkill']).toBe(true);
  });

  it('is idempotent: re-running updates the same meta-skill node', () => {
    acceptedPatch('Add evaluation evidence ids to skills.');
    acceptedPatch('Tighten vague guidance into bounded steps.');
    acceptedPatch('Add verification step before accepting changes.');

    const first = synthesizeMetaSkill({ graphStore, evolutionStore }, { project: 'mindstrate', minAcceptedPatches: 3 });
    const second = synthesizeMetaSkill({ graphStore, evolutionStore }, { project: 'mindstrate', minAcceptedPatches: 3 });

    expect(first!.nodeId).toBe(second!.nodeId);
    const heuristics = graphStore.listNodes({ project: 'mindstrate', substrateType: SubstrateType.HEURISTIC });
    expect(heuristics).toHaveLength(1);
  });
});
