import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ContextPrioritySelector } from '../src/context-graph/context-priority-selector.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('ContextPrioritySelector', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let selector: ContextPrioritySelector;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    selector = new ContextPrioritySelector(graphStore);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('selects nodes per ECS layer in priority order', () => {
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Summary 1',
      content: 'summary',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Pattern 1',
      content: 'pattern',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule 1',
      content: 'rule',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const selection = selector.select({
      project: 'mindstrate',
      perLayerLimit: 3,
    });

    expect(selection.rules.map((node) => node.title)).toEqual(['Rule 1']);
    expect(selection.patterns.map((node) => node.title)).toEqual(['Pattern 1']);
    expect(selection.summaries.map((node) => node.title)).toEqual(['Summary 1']);
  });

  it('excludes conflicted and inactive nodes from default working context selection', () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Active Rule',
      content: 'safe rule',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Conflicted Rule',
      content: 'conflicted rule',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });
    graphStore.createNode({
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      title: 'Deprecated Pattern',
      content: 'deprecated pattern',
      project: 'mindstrate',
      status: ContextNodeStatus.DEPRECATED,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Archived Summary',
      content: 'archived summary',
      project: 'mindstrate',
      status: ContextNodeStatus.ARCHIVED,
    });

    const selection = selector.select({
      project: 'mindstrate',
      perLayerLimit: 5,
    });

    expect(selection.rules.map((node) => node.title)).toEqual(['Active Rule']);
    expect(selection.patterns).toEqual([]);
    expect(selection.summaries).toEqual([]);
  });

  it('prioritizes nodes that match file, dependency, and error context', () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'General testing rule',
      content: 'Run focused tests before changing any runtime code.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 90,
    });
    const matched = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.TROUBLESHOOTING,
      title: 'Fix hydration failures in app router',
      content: 'Hydration mismatch in app/page.tsx usually means server and client markup diverged.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 70,
      metadata: {
        framework: 'next',
        files: ['src/app/page.tsx'],
        dependencies: ['react'],
      },
    });

    const selection = selector.select({
      project: 'mindstrate',
      perLayerLimit: 1,
      context: {
        currentFile: 'src/app/page.tsx',
        currentFramework: 'next',
        projectDependencies: ['react'],
        errorMessage: 'Hydration mismatch while rendering app router page',
      },
    });

    expect(selection.rules.map((node) => node.id)).toEqual([matched.id]);
  });
});
