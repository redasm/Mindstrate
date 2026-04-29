import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ConflictDetector } from '../src/context-graph/conflict-detector.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('ConflictDetector', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let detector: ConflictDetector;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    detector = new ConflictDetector(graphStore, new Embedder(''));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('detects contradictory high-similarity rule nodes', async () => {
    const first = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const second = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const result = await detector.detectConflicts({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      similarityThreshold: 0.55,
    });

    expect(result.conflictsDetected).toBe(1);

    const records = graphStore.listConflictRecords({ project: 'mindstrate' });
    expect(records).toHaveLength(1);
    expect(records[0].nodeIds).toEqual(expect.arrayContaining([first.id, second.id]));

    expect(graphStore.getNodeById(first.id)?.status).toBe(ContextNodeStatus.CONFLICTED);
    expect(graphStore.getNodeById(second.id)?.status).toBe(ContextNodeStatus.CONFLICTED);

    const outgoing = graphStore.listOutgoingEdges(first.id, ContextRelationType.CONTRADICTS);
    expect(outgoing).toHaveLength(1);
  });

  it('does not create duplicate conflict records for the same pair', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule A',
      content: 'Use hydration-safe SSR and browser checks during render are supported.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Rule B',
      content: 'Use hydration-safe SSR but do not run browser checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    await detector.detectConflicts({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      similarityThreshold: 0.55,
    });
    const secondRun = await detector.detectConflicts({
      project: 'mindstrate',
      substrateType: SubstrateType.RULE,
      similarityThreshold: 0.55,
    });

    expect(secondRun.conflictsDetected).toBe(0);
    expect(graphStore.listConflictRecords({ project: 'mindstrate' })).toHaveLength(1);
  });
});
