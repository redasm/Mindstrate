import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
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
});
