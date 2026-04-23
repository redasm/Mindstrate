import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { PortableContextBundleManager } from '../src/bundles/portable-context-bundle.js';
import { createTempDir, removeTempDir } from './helpers.js';
import { ContextDomainType, ContextRelationType, ContextNodeStatus, SubstrateType } from '@mindstrate/protocol/models';

describe('PortableContextBundleManager', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let bundles: PortableContextBundleManager;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'bundle.db'));
    bundles = new PortableContextBundleManager(graphStore);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates, validates, and installs a bundle', () => {
    const source = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Always verify ECS changes with build and focused tests.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const target = graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Pattern B',
      content: 'Graph-first retrieval improves task context quality.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createEdge({
      sourceId: target.id,
      targetId: source.id,
      relationType: ContextRelationType.GENERALIZES,
      strength: 1,
    });

    const bundle = bundles.createBundle({
      name: 'ecs-core-rules',
      project: 'mindstrate',
    });
    const validation = bundles.validateBundle(bundle);

    expect(validation.valid).toBe(true);
    expect(bundle.nodes).toHaveLength(2);
    expect(bundle.edges).toHaveLength(1);

    const freshStore = new ContextGraphStore(path.join(tempDir, 'bundle-installed.db'));
    const freshBundles = new PortableContextBundleManager(freshStore);
    const install = freshBundles.installBundle(bundle);

    expect(install.installedNodes).toBe(2);
    expect(install.installedEdges).toBe(1);
    expect(freshStore.listNodes({ project: 'mindstrate', limit: 10 })).toHaveLength(2);
    expect(freshStore.listEdges({ limit: 10 })).toHaveLength(1);

    freshStore.close();
  });
});
