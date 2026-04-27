import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
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

  it('normalizes raw context events into canonical episode nodes', () => {
    const event = graphStore.createEvent({
      type: ContextEventType.TERMINAL_OUTPUT,
      project: 'mindstrate',
      actor: 'terminal',
      content: 'npm test failed with assertion output',
      metadata: {
        command: 'npm test',
        exitCode: 1,
      },
    });

    const digest = new DigestEngine(graphStore).run({ project: 'mindstrate' });
    const episodes = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.EPISODE,
      limit: 10,
    });

    expect(digest.created).toBe(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].sourceRef).toBe(`event:${event.id}`);
    expect(episodes[0].metadata?.['eventId']).toBe(event.id);
    expect(episodes[0].metadata?.['normalizedEvent']).toEqual(expect.objectContaining({
      type: ContextEventType.TERMINAL_OUTPUT,
      source: 'terminal',
      command: 'npm test',
      exitCode: 1,
    }));

    const secondDigest = new DigestEngine(graphStore).run({ project: 'mindstrate' });
    expect(secondDigest.created).toBe(0);
    expect(graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.EPISODE,
      limit: 10,
    })).toHaveLength(1);
  });

  it('links overlapping episodes to existing snapshots instead of duplicating them', () => {
    const existing = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Existing graph query snapshot',
      content: 'Observed failing graph query and fixed edge filtering.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    const episode = graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Repeated graph query observation',
      content: 'Observed failing graph query while fixing edge filtering.',
      project: 'mindstrate',
      sourceRef: 'session-overlap',
    });

    const assimilate = new Assimilator(graphStore).run({ project: 'mindstrate' });

    expect(assimilate.created).toBe(0);
    expect(assimilate.updated).toBe(1);
    expect(graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SNAPSHOT,
      limit: 10,
    })).toHaveLength(1);
    expect(graphStore.listEdges({
      sourceId: episode.id,
      targetId: existing.id,
      relationType: ContextRelationType.SUPPORTS,
    })).toHaveLength(1);
  });

  it('marks contradictory assimilated snapshots as conflicted', () => {
    const existing = graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Existing SSR rule',
      content: 'Use client hydration for SSR state handoff.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.EPISODE,
      domainType: ContextDomainType.CONTEXT_EVENT,
      title: 'Contradictory SSR observation',
      content: 'Do not use client hydration for SSR state handoff.',
      project: 'mindstrate',
      sourceRef: 'session-conflict',
    });

    const assimilate = new Assimilator(graphStore).run({ project: 'mindstrate' });
    const snapshots = graphStore.listNodes({
      project: 'mindstrate',
      substrateType: SubstrateType.SNAPSHOT,
      limit: 10,
    });
    const created = snapshots.find((node) => node.id !== existing.id)!;

    expect(assimilate.created).toBe(1);
    expect(assimilate.updated).toBeGreaterThanOrEqual(1);
    expect(graphStore.getNodeById(existing.id)?.status).toBe(ContextNodeStatus.CONFLICTED);
    expect(graphStore.getNodeById(created.id)?.status).toBe(ContextNodeStatus.CONFLICTED);
    expect(graphStore.listEdges({
      sourceId: created.id,
      targetId: existing.id,
      relationType: ContextRelationType.CONTRADICTS,
    })).toHaveLength(1);
    expect(graphStore.listConflictRecords({ project: 'mindstrate' })).toHaveLength(1);
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
