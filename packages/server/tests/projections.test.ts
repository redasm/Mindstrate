import * as path from 'node:path';
import * as fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectionTarget,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import {
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from '../src/projections/index.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('ECS projections', () => {
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

  it('materializes session summary nodes as session projection records', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot',
      content: 'A completed session snapshot.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      sourceRef: 'session-123',
    });

    const materializer = new SessionProjectionMaterializer(graphStore);
    const records = materializer.materialize({ project: 'mindstrate' });

    expect(records).toHaveLength(1);
    expect(records[0].nodeId).toBe(node.id);
    expect(records[0].target).toBe(ProjectionTarget.SESSION_SUMMARY);
    expect(records[0].targetRef).toBe('session-123');
  });

  it('materializes project snapshot nodes as project snapshot records', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      title: 'Project snapshot',
      content: 'Current project architecture snapshot.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      sourceRef: 'project:mindstrate',
    });

    const materializer = new ProjectSnapshotProjectionMaterializer(graphStore);
    const records = materializer.materialize({ project: 'mindstrate' });

    expect(records).toHaveLength(1);
    expect(records[0].nodeId).toBe(node.id);
    expect(records[0].target).toBe(ProjectionTarget.PROJECT_SNAPSHOT);
    expect(records[0].targetRef).toBe('project:mindstrate');
  });

  it('materializes stable nodes as obsidian document projections', () => {
    const node = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Prefer graph projections',
      content: 'Stable ECS rules should be editable as markdown projections.',
      project: 'mindstrate',
      status: ContextNodeStatus.VERIFIED,
    });

    const materializer = new ObsidianProjectionMaterializer(graphStore);
    const records = materializer.materialize({ project: 'mindstrate' });

    expect(records).toHaveLength(1);
    expect(records[0].nodeId).toBe(node.id);
    expect(records[0].target).toBe(ProjectionTarget.OBSIDIAN_DOCUMENT);
    expect(records[0].targetRef).toBe('mindstrate/rules/prefer-graph-projections.md');
  });

  it('writes stable node projections to editable markdown files', () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Keep ECS canonical',
      content: 'Graph nodes remain canonical while markdown is editable projection.',
      project: 'mindstrate',
      status: ContextNodeStatus.VERIFIED,
      tags: ['ecs'],
    });

    const materializer = new ObsidianProjectionMaterializer(graphStore);
    const files = materializer.writeFiles({
      project: 'mindstrate',
      rootDir: tempDir,
    });

    const filePath = path.join(tempDir, 'mindstrate', 'rules', 'keep-ecs-canonical.md');
    expect(files).toEqual([filePath]);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('Graph nodes remain canonical');
  });
});
