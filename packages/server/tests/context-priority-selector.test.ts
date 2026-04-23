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
});
