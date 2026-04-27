import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('ContextGraphStore', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('creates and retrieves nodes', () => {
    const node = store.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.BUG_FIX,
      title: 'Login timeout during tests',
      content: 'Observed repeated timeout in auth integration tests.',
      project: 'mindstrate',
      tags: ['auth', 'tests'],
    });

    const fetched = store.getNodeById(node.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe(node.title);
    expect(fetched?.status).toBe(ContextNodeStatus.CANDIDATE);
    expect(fetched?.tags).toEqual(['auth', 'tests']);
  });

  it('updates and filters nodes', () => {
    const node = store.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session summary',
      content: 'Compressed summary of auth debugging session.',
      project: 'mindstrate',
    });

    store.updateNode(node.id, {
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 72,
    });

    const filtered = store.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SUMMARY,
      status: ContextNodeStatus.ACTIVE,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].qualityScore).toBe(72);
  });

  it('tracks graph node versions across controlled updates', () => {
    const node = store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Versioned rule',
      content: 'Initial content.',
      project: 'mindstrate',
    });

    const updated = store.updateNode(node.id, {
      content: 'Updated content.',
    });

    expect(node.metadata?.['graphVersion']).toBe(1);
    expect(updated?.metadata?.['graphVersion']).toBe(2);
    expect(updated?.metadata?.['previousGraphHash']).toBeTruthy();
  });

  it('records access counts', () => {
    const node = store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Always preserve invariants',
      content: 'Do not add defensive null checks for startup invariants.',
    });

    store.recordNodeAccess(node.id, '2026-04-23T00:00:00.000Z');
    store.recordNodeAccess(node.id, '2026-04-23T01:00:00.000Z');

    const fetched = store.getNodeById(node.id);
    expect(fetched?.accessCount).toBe(2);
    expect(fetched?.lastAccessedAt).toBe('2026-04-23T01:00:00.000Z');
  });

  it('creates edges between nodes', () => {
    const source = store.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Pytest failure observed',
      content: 'CI timeout observed in auth tests.',
    });
    const target = store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.TROUBLESHOOTING,
      title: 'Auth test troubleshooting snapshot',
      content: 'Clustered auth timeout observations and likely causes.',
    });

    const edge = store.createEdge({
      sourceId: source.id,
      targetId: target.id,
      relationType: ContextRelationType.DERIVED_FROM,
      strength: 0.9,
    });

    expect(store.getEdgeById(edge.id)?.relationType).toBe(ContextRelationType.DERIVED_FROM);
    expect(store.listOutgoingEdges(source.id)).toHaveLength(1);
    expect(store.listIncomingEdges(target.id)).toHaveLength(1);
  });

  it('creates and lists events', () => {
    const event = store.createEvent({
      type: ContextEventType.SESSION_OBSERVATION,
      project: 'mindstrate',
      sessionId: 'session-1',
      actor: 'agent',
      content: 'Selected graph-first ECS migration strategy.',
      observedAt: '2026-04-23T02:30:00.000Z',
      metadata: { observationType: 'decision' },
    });

    const fetched = store.getEventById(event.id);
    expect(fetched?.actor).toBe('agent');
    expect(store.listEvents({ project: 'mindstrate' })).toHaveLength(1);
    expect(store.listEvents({ type: ContextEventType.SESSION_OBSERVATION })[0].content)
      .toContain('graph-first ECS');
  });

  it('stores node embeddings as a graph-native shadow index', () => {
    const node = store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Graph embeddings belong with nodes',
      content: 'Node embeddings should be addressable by node id.',
    });

    const embedding = store.upsertNodeEmbedding({
      nodeId: node.id,
      model: 'test-embedding',
      dimensions: 3,
      embedding: [0.1, 0.2, 0.3],
      text: 'Graph embeddings belong with nodes',
    });

    expect(embedding.nodeId).toBe(node.id);
    expect(embedding.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(store.getNodeEmbedding(node.id, 'test-embedding')?.dimensions).toBe(3);

    store.deleteNode(node.id);

    expect(store.getNodeEmbedding(node.id, 'test-embedding')).toBeNull();
  });
});
