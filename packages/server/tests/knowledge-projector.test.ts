import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  PROJECT_GRAPH_METADATA_KEYS,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('GraphKnowledgeProjector', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let projector: GraphKnowledgeProjector;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    projector = new GraphKnowledgeProjector(graphStore);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('projects higher-order ECS nodes ordered by substrate priority', () => {
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Summary Node',
      content: 'Summary paragraph.\n\nMore detail.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 60,
      confidence: 0.8,
    });
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule Node',
      content: 'Rule paragraph.\n\nMore detail.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 60,
      confidence: 0.8,
    });

    const projected = projector.project({ project: 'mindstrate', limit: 10 });
    expect(projected).toHaveLength(2);
    expect(projected[0].title).toBe('Rule Node');
    expect(projected[1].title).toBe('Summary Node');
    expect(projected[0].summary).toBe('Rule paragraph.');
  });

  it('returns every knowledge node when no limit is given (count is not capped)', () => {
    for (let i = 0; i < 60; i++) {
      graphStore.createNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: `Rule ${i}`,
        content: `Body ${i}`,
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
        qualityScore: 60,
        confidence: 0.8,
      });
    }

    // No limit → all 60 come back, not a default-capped slice.
    expect(projector.project({ project: 'mindstrate' })).toHaveLength(60);
    // An explicit limit still caps.
    expect(projector.project({ project: 'mindstrate', limit: 10 })).toHaveLength(10);
  });

  it('projects project snapshots so first-run vault export is not empty', () => {
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      title: 'Project Snapshot',
      content: 'Project overview',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const projected = projector.project({ project: 'mindstrate', limit: 10 });
    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual(expect.objectContaining({
      title: 'Project Snapshot',
      substrateType: SubstrateType.SNAPSHOT,
    }));
  });

  it('filters out low-level substrate nodes from the projected view', () => {
    graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Episode Node',
      content: 'Raw event',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const projected = projector.project({ project: 'mindstrate', limit: 10 });
    expect(projected).toEqual([]);
  });

  it('does not project low-level project graph facts by default', () => {
    const node = graphStore.createNode({
      id: 'pg:mindstrate:function:add-tag',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'AddTag',
      content: 'function: AddTag',
      tags: ['project-graph', 'function'],
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
        [PROJECT_GRAPH_METADATA_KEYS.kind]: 'function',
      },
    });

    expect(projector.project({ project: 'mindstrate', limit: 10 })).toEqual([]);
    expect(projector.project({
      project: 'mindstrate',
      limit: 10,
      includeProjectGraphNodes: true,
    })[0].id).toBe(node.id);
  });

  it('surfaces knowledge even when a large project graph would fill the prefetch window', () => {
    // Knowledge node first…
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Important Rule',
      content: 'Keep me visible.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      confidence: 0.9,
    });
    // …then 600 project-graph nodes (more than the old 500 prefetch window),
    // all with newer updated_at, which used to evict the rule from the result.
    for (let i = 0; i < 600; i++) {
      graphStore.createNode({
        id: `pg:mindstrate:file:f${i}`,
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.ARCHITECTURE,
        title: `file-${i}.ts`,
        content: `file: file-${i}.ts`,
        tags: ['project-graph', 'file'],
        project: 'mindstrate',
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
          [PROJECT_GRAPH_METADATA_KEYS.kind]: 'file',
        },
      });
    }

    const projected = projector.project({ project: 'mindstrate', limit: 10 });
    expect(projected.map((v) => v.title)).toContain('Important Rule');
  });
});
