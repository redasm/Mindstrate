import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('context graph store boundaries', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('persists nodes and edges through the graph store boundary', () => {
    const source = graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Observed failure',
      content: 'A failing test was observed.',
      project: 'mindstrate',
    });
    const target = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Debugging snapshot',
      content: 'The failure was summarized.',
      project: 'mindstrate',
    });
    const edge = graphStore.createEdge({
      sourceId: source.id,
      targetId: target.id,
      relationType: ContextRelationType.DERIVED_FROM,
    });

    expect(graphStore.getNodeById(source.id)?.title).toBe('Observed failure');
    expect(graphStore.getEdgeById(edge.id)?.targetId).toBe(target.id);
  });

  it('queries neighborhood nodes through graph-query', () => {
    const query = graphStore.createGraphQuery();

    const source = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Use graph store boundary',
      content: 'Graph access should be discoverable by module name.',
    });
    const target = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Repository naming pattern',
      content: 'Documented module names should resolve to focused graph operations.',
    });
    graphStore.createEdge({
      sourceId: source.id,
      targetId: target.id,
      relationType: ContextRelationType.SUPPORTS,
    });

    const neighborhood = query.neighborhood(source.id);

    expect(neighborhood.center?.id).toBe(source.id);
    expect(neighborhood.outgoingNodes.map((node) => node.id)).toEqual([target.id]);
    expect(neighborhood.incomingNodes).toEqual([]);
  });
});
