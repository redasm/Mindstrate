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
import { createTempDir, removeTempDir } from './test-support.js';

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

  it('searchSimilarNodes caps the candidate scan and prefers high-quality nodes', () => {
    // Insert more embedded nodes than the candidate limit. Without the cap the
    // whole set is JSON-parsed into memory (the OOM that crashed team-server on
    // a 100k-node project); the cap keeps the scan bounded.
    for (let i = 0; i < 30; i++) {
      const n = store.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: `node ${i}`,
        content: `c${i}`,
        project: 'big',
        status: ContextNodeStatus.ACTIVE,
        qualityScore: i, // higher i = higher quality
      });
      store.upsertNodeEmbedding({ nodeId: n.id, model: 'm', dimensions: 2, embedding: [1, 0] });
    }

    const hits = store.searchSimilarNodes({
      queryEmbedding: [1, 0],
      model: 'm',
      project: 'big',
      topK: 50,
      candidateLimit: 5,
    });

    // Only the 5 highest-quality candidates are scanned, so at most 5 returned.
    expect(hits.length).toBeLessThanOrEqual(5);
    // The top quality nodes (29, 28, …) must be the ones that surface.
    const titles = hits.map((h) => store.getNodeById(h.nodeId)?.title);
    expect(titles).toContain('node 29');
    expect(titles).not.toContain('node 0');
  });

  it('deletes every row for a project (case-insensitive) and leaves others intact', () => {
    const seed = (project: string) => {
      const a = store.createNode({
        substrateType: SubstrateType.EPISODE,
        domainType: ContextDomainType.BUG_FIX,
        title: `${project} A`,
        content: 'x',
        project,
      });
      const b = store.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: `${project} B`,
        content: 'y',
        project,
      });
      const edge = store.createEdge({ sourceId: a.id, targetId: b.id, relationType: ContextRelationType.DERIVED_FROM });
      store.upsertNodeEmbedding({ nodeId: a.id, model: 'm', dimensions: 3, embedding: [0.1, 0.2, 0.3] });
      store.createEvent({
        type: ContextEventType.SESSION_OBSERVATION,
        project,
        content: 'evt',
        observedAt: '2026-01-01T00:00:00.000Z',
      });
      return { a, b, edge };
    };
    const keep = seed('keepme');
    const drop = seed('dropme');

    const result = store.deleteProject('DROPME'); // upper-case → exercises LOWER() match
    expect(result.nodesDeleted).toBe(2);

    expect(store.listNodes({ project: 'dropme' })).toHaveLength(0);
    expect(store.getEdgeById(drop.edge.id)).toBeNull();
    expect(store.getNodeEmbedding(drop.a.id, 'm')).toBeNull();
    expect(store.listEvents({ project: 'dropme' })).toHaveLength(0);

    expect(store.listNodes({ project: 'keepme' })).toHaveLength(2);
    expect(store.getEdgeById(keep.edge.id)).not.toBeNull();
    expect(store.getNodeEmbedding(keep.a.id, 'm')).not.toBeNull();
    expect(store.listEvents({ project: 'keepme' })).toHaveLength(1);
  });

  it('deleteProjectGraphNodes removes only scanner-extracted nodes, keeping manual knowledge', () => {
    const fileNode = store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src/app.ts',
      content: 'file: src/app.ts',
      project: 'demo',
      metadata: { projectGraph: true, kind: 'file' },
    });
    const manual = store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Hand-written rule',
      content: 'Always validate input.',
      project: 'demo',
    });
    store.upsertNodeEmbedding({ nodeId: fileNode.id, model: 'm', dimensions: 3, embedding: [0.1, 0.2, 0.3] });
    store.upsertNodeEmbedding({ nodeId: manual.id, model: 'm', dimensions: 3, embedding: [0.4, 0.5, 0.6] });

    const result = store.deleteProjectGraphNodes('DEMO'); // case-insensitive

    expect(result.nodesDeleted).toBe(1);
    expect(store.getNodeById(fileNode.id)).toBeNull();
    expect(store.getNodeEmbedding(fileNode.id, 'm')).toBeNull();
    // Manually-authored knowledge and its embedding survive.
    expect(store.getNodeById(manual.id)).not.toBeNull();
    expect(store.getNodeEmbedding(manual.id, 'm')).not.toBeNull();
  });

  it('countProjectGraphNodes counts only scanner-extracted nodes', () => {
    store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src/a.ts',
      content: 'file: src/a.ts',
      project: 'demo',
      metadata: { projectGraph: true, kind: 'file' },
    });
    store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'manual rule',
      content: 'keep me',
      project: 'demo',
    });

    expect(store.countProjectGraphNodes('demo')).toBe(1);
    expect(store.countProjectGraphNodes('DEMO')).toBe(1); // case-insensitive
    expect(store.countProjectGraphNodes('other')).toBe(0);

    // After wiping project-graph nodes the count is 0 even though manual
    // knowledge remains — this is what lets a forced P4 re-scan rebuild.
    store.deleteProjectGraphNodes('demo');
    expect(store.countProjectGraphNodes('demo')).toBe(0);
    expect(store.listNodes({ project: 'demo' })).toHaveLength(1);
  });

  it('queryProjectSubgraph: skeleton, focus neighborhood, and kind filter', () => {
    const pgNode = (title: string, kind: string) => store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title,
      content: `${kind}: ${title}`,
      project: 'demo',
      metadata: { projectGraph: true, kind },
    });
    const pgEdge = (s: string, t: string, kind: string) => store.createEdge({
      sourceId: s,
      targetId: t,
      relationType: ContextRelationType.APPLIES_TO,
      evidence: { projectGraph: true, kind },
    });

    const dir = pgNode('src', 'directory');
    const file = pgNode('src/app.ts', 'file');
    const cls = pgNode('App', 'class');
    const contains = pgEdge(dir.id, file.id, 'contains');
    const defines = pgEdge(file.id, cls.id, 'defines');

    // skeleton: directory + file only, internal edges only
    const skel = store.queryProjectSubgraph({ project: 'demo' });
    expect(skel.nodes.map((n) => n.id).sort()).toEqual([dir.id, file.id].sort());
    expect(skel.edges.map((e) => e.id)).toEqual([contains.id]);

    // focus: file + one-hop neighbors (dir, cls) + both touching edges
    const focus = store.queryProjectSubgraph({ project: 'demo', focusNodeId: file.id });
    expect(focus.nodes.map((n) => n.id).sort()).toEqual([cls.id, dir.id, file.id].sort());
    expect(focus.edges.map((e) => e.id).sort()).toEqual([contains.id, defines.id].sort());

    // kind filter
    const classes = store.queryProjectSubgraph({ project: 'demo', nodeKinds: ['class'] });
    expect(classes.nodes.map((n) => n.id)).toEqual([cls.id]);
  });

  it('projectGraphNeighborhood and projectGraphShortestPath: bounded BFS', () => {
    const pgNode = (title: string, kind: string) => store.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title,
      content: `${kind}: ${title}`,
      project: 'demo',
      metadata: { projectGraph: true, kind },
    });
    const pgEdge = (s: string, t: string, kind: string) => store.createEdge({
      sourceId: s,
      targetId: t,
      relationType: ContextRelationType.APPLIES_TO,
      evidence: { projectGraph: true, kind },
    });

    const dir = pgNode('src', 'directory');
    const file = pgNode('src/app.ts', 'file');
    const cls = pgNode('App', 'class');
    const far = pgNode('Unrelated', 'class');
    pgEdge(dir.id, file.id, 'contains');
    pgEdge(file.id, cls.id, 'defines');

    // depth 0 → only the seed
    const seedOnly = store.projectGraphNeighborhood({ seedIds: [file.id], depth: 0, limit: 50 });
    expect(seedOnly.nodes.map((n) => n.id)).toEqual([file.id]);

    // depth 1 from file → file + dir + cls
    const oneHop = store.projectGraphNeighborhood({ seedIds: [file.id], depth: 1, limit: 50 });
    expect(oneHop.nodes.map((n) => n.id).sort()).toEqual([cls.id, dir.id, file.id].sort());

    // limit caps the result set
    const capped = store.projectGraphNeighborhood({ seedIds: [file.id], depth: 2, limit: 2 });
    expect(capped.nodes.length).toBe(2);

    // far node is unreachable, never included
    const reachable = store.projectGraphNeighborhood({ seedIds: [dir.id], depth: 5, limit: 50 });
    expect(reachable.nodes.map((n) => n.id)).not.toContain(far.id);

    // shortest path dir → cls is dir → file → cls
    const path = store.projectGraphShortestPath({ fromId: dir.id, toId: cls.id, maxDepth: 5 });
    expect(path?.nodes.map((n) => n.id)).toEqual([dir.id, file.id, cls.id]);
    expect(path?.edges.length).toBe(2);

    // no path to the disconnected node
    expect(store.projectGraphShortestPath({ fromId: dir.id, toId: far.id, maxDepth: 5 })).toBeNull();
    // unknown endpoint
    expect(store.projectGraphShortestPath({ fromId: dir.id, toId: 'nope', maxDepth: 5 })).toBeNull();
  });
});
