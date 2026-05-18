/**
 * Regression tests for case-insensitive project filtering.
 *
 * Before this fix, every list/query that filtered by `project` used
 * SQL equality, so `Mindstrate` ≠ `mindstrate` and a caller that
 * passed the human-cased project name would silently get zero rows
 * even though the data was right there. The fix uses `LOWER(project)
 * = LOWER(?)` plus an expression index so both shapes resolve.
 */

import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('Case-insensitive project filtering', () => {
  let tempDir: string;
  let store: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new ContextGraphStore(path.join(tempDir, 'cs.db'));
  });

  afterEach(() => {
    store.close();
    removeTempDir(tempDir);
  });

  it('finds a node persisted as `mindstrate` when the caller queries `Mindstrate`', () => {
    store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Sample',
      content: 'Sample rule body.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    expect(store.listNodes({ project: 'Mindstrate' })).toHaveLength(1);
    expect(store.listNodes({ project: 'MINDSTRATE' })).toHaveLength(1);
    expect(store.listNodes({ project: 'mindstrate' })).toHaveLength(1);
  });

  it('does not match a different project by accident', () => {
    store.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Sample',
      content: 'Sample rule body.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    expect(store.listNodes({ project: 'mindstrate-other' })).toHaveLength(0);
    expect(store.listNodes({ project: 'OTHER' })).toHaveLength(0);
  });

  it('case-folds the project filter for context events too', () => {
    store.createEvent({
      type: ContextEventType.SESSION_OBSERVATION,
      project: 'Mindstrate',
      content: 'observation',
      observedAt: new Date().toISOString(),
    });
    expect(store.listEvents({ project: 'mindstrate' })).toHaveLength(1);
    expect(store.listEvents({ project: 'MINDSTRATE' })).toHaveLength(1);
  });
});
