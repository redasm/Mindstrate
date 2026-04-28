import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ConflictReflector } from '../src/context-graph/conflict-reflector.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('ConflictReflector', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let reflector: ConflictReflector;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    reflector = new ConflictReflector(graphStore);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates candidate reflection nodes for unresolved conflicts', () => {
    const first = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const second = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const conflict = graphStore.createConflictRecord({
      project: 'mindstrate',
      nodeIds: [first.id, second.id],
      reason: 'High-similarity contradictory nodes detected (0.91)',
      detectedAt: '2026-04-23T12:00:00.000Z',
    });

    const result = reflector.reflectConflicts({ project: 'mindstrate' });
    expect(result.candidateNodesCreated).toBe(1);
    expect(result.auditEventIds).toHaveLength(1);

    const candidates = graphStore.listNodes({
      sourceRef: conflict.id,
      substrateType: SubstrateType.SUMMARY,
      limit: 10,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe(ContextNodeStatus.CANDIDATE);
    expect(candidates[0].content).toContain('Reflection task:');

    const incoming = graphStore.listIncomingEdges(candidates[0].id, ContextRelationType.DERIVED_FROM);
    expect(incoming).toHaveLength(2);

    const auditEvents = graphStore.listEvents({ project: 'mindstrate', limit: 10 });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe('metabolic_output');
    expect(auditEvents[0].metadata?.['conflictId']).toBe(conflict.id);
    expect(auditEvents[0].metadata?.['candidateNodeId']).toBe(candidates[0].id);
  });

  it('does not create duplicate reflection nodes for the same conflict', () => {
    const first = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const second = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    graphStore.createConflictRecord({
      project: 'mindstrate',
      nodeIds: [first.id, second.id],
      reason: 'High-similarity contradictory nodes detected (0.91)',
    });

    reflector.reflectConflicts({ project: 'mindstrate' });
    const secondRun = reflector.reflectConflicts({ project: 'mindstrate' });

    expect(secondRun.candidateNodesCreated).toBe(0);
  });

  it('accepts a reflection candidate and resolves the source conflict', () => {
    const first = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const second = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const conflict = graphStore.createConflictRecord({
      project: 'mindstrate',
      nodeIds: [first.id, second.id],
      reason: 'High-similarity contradictory nodes detected (0.91)',
    });
    const { candidateNodeIds } = reflector.reflectConflicts({ project: 'mindstrate' });

    const result = reflector.acceptCandidate({
      conflictId: conflict.id,
      candidateNodeId: candidateNodeIds[0],
      resolution: 'Accepted narrower SSR rule.',
    });

    expect(result.resolved?.resolvedAt).toBeTruthy();
    expect(result.acceptedNode?.status).toBe(ContextNodeStatus.VERIFIED);
    expect(graphStore.getNodeById(first.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getNodeById(second.id)?.status).toBe(ContextNodeStatus.ARCHIVED);
  });

  it('rejects a reflection candidate without resolving the source conflict', () => {
    const first = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const second = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    const conflict = graphStore.createConflictRecord({
      project: 'mindstrate',
      nodeIds: [first.id, second.id],
      reason: 'High-similarity contradictory nodes detected (0.91)',
    });
    const { candidateNodeIds } = reflector.reflectConflicts({ project: 'mindstrate' });

    const result = reflector.rejectCandidate({
      conflictId: conflict.id,
      candidateNodeId: candidateNodeIds[0],
      reason: 'Candidate is too vague.',
    });

    expect(result.rejectedNode?.status).toBe(ContextNodeStatus.ARCHIVED);
    expect(graphStore.getConflictRecordById(conflict.id)?.resolvedAt).toBeUndefined();
  });
});
