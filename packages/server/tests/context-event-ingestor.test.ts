import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ingestContextEvent } from '../src/events/context-event.js';
import { createTempDir, removeTempDir } from './helpers.js';
import { ContextEventType, ContextRelationType, SubstrateType } from '@mindstrate/protocol/models';

describe('ingestContextEvent', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-events.db'));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('creates an event, episode node, and follows edge for the same source stream', () => {
    const first = ingestContextEvent(graphStore, {
      type: ContextEventType.TEST_RESULT,
      content: 'Jest failed in auth/login.spec.ts',
      project: 'mindstrate',
      sourceRef: 'test-run:auth',
    });
    const second = ingestContextEvent(graphStore, {
      type: ContextEventType.TEST_RESULT,
      content: 'Jest still failing after patch in auth/login.spec.ts',
      project: 'mindstrate',
      sourceRef: 'test-run:auth',
    });

    expect(first.event.id).toBeTruthy();
    expect(second.node.substrateType).toBe(SubstrateType.EPISODE);
    const follows = graphStore.listIncomingEdges(second.node.id, ContextRelationType.FOLLOWS);
    expect(follows).toHaveLength(1);
    expect(follows[0].sourceId).toBe(first.node.id);
  });
});
