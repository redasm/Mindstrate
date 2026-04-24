import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import {
  ContextEdgeRepository,
  ContextNodeRepository,
  GraphQuery,
} from '../src/context-graph/index.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('context graph repositories', () => {
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

  it('wraps node and edge persistence behind document-named repositories', () => {
    const nodes = new ContextNodeRepository(graphStore);
    const edges = new ContextEdgeRepository(graphStore);

    const source = nodes.create({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Observed failure',
      content: 'A failing test was observed.',
      project: 'mindstrate',
    });
    const target = nodes.create({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Debugging snapshot',
      content: 'The failure was summarized.',
      project: 'mindstrate',
    });
    const edge = edges.create({
      sourceId: source.id,
      targetId: target.id,
      relationType: ContextRelationType.DERIVED_FROM,
    });

    expect(nodes.get(source.id)?.title).toBe('Observed failure');
    expect(edges.get(edge.id)?.targetId).toBe(target.id);
  });

  it('queries neighborhood nodes through graph-query', () => {
    const nodes = new ContextNodeRepository(graphStore);
    const edges = new ContextEdgeRepository(graphStore);
    const query = new GraphQuery(nodes, edges);

    const source = nodes.create({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Use repository wrappers',
      content: 'Graph access should be discoverable by module name.',
    });
    const target = nodes.create({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Repository naming pattern',
      content: 'Documented module names should resolve to focused wrappers.',
    });
    edges.create({
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
