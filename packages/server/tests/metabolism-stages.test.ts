import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  MetabolismStage,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ConflictDetector } from '../src/context-graph/conflict-detector.js';
import { ConflictReflector } from '../src/context-graph/conflict-reflector.js';
import { PatternCompressor } from '../src/context-graph/pattern-compressor.js';
import { RuleCompressor } from '../src/context-graph/rule-compressor.js';
import { SummaryCompressor } from '../src/context-graph/summary-compressor.js';
import { Assimilator, DigestEngine, MetabolicCompressor, Reflector } from '../src/metabolism/index.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './helpers.js';

describe('metabolism stage modules', () => {
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

  it('runs digest and assimilation as independent stage classes', () => {
    graphStore.createEvent({
      type: ContextEventType.SESSION_OBSERVATION,
      project: 'mindstrate',
      content: 'Observed a failing graph query.',
    });
    graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Graph query failure',
      content: 'Observed a failing graph query.',
      project: 'mindstrate',
      sourceRef: 'session-1',
    });

    const digest = new DigestEngine(graphStore).run({ project: 'mindstrate' });
    const assimilate = new Assimilator(graphStore).run({ project: 'mindstrate' });

    expect(digest.stage).toBe(MetabolismStage.DIGEST);
    expect(digest.scanned).toBe(1);
    expect(assimilate.stage).toBe(MetabolismStage.ASSIMILATE);
    expect(assimilate.created).toBe(1);
  });

  it('runs compression and reflection as independent stage classes', async () => {
    const embedder = new Embedder('');
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Snapshot A',
      content: 'Use tests before changing ECS runtime behavior.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Snapshot B',
      content: 'Run tests before editing ECS runtime behavior.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });

    const compression = await new MetabolicCompressor({
      summaryCompressor: new SummaryCompressor(graphStore, embedder),
      patternCompressor: new PatternCompressor(graphStore, embedder),
      ruleCompressor: new RuleCompressor(graphStore, embedder),
    }).run({ project: 'mindstrate' });
    const reflection = await new Reflector({
      conflictDetector: new ConflictDetector(graphStore, embedder),
      conflictReflector: new ConflictReflector(graphStore),
    }).run({ project: 'mindstrate' });

    expect(compression.summary.summaryNodesCreated).toBeGreaterThanOrEqual(1);
    expect(reflection.stage).toBe(MetabolismStage.REFLECT);
  });
});
