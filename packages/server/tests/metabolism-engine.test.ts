import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { SummaryCompressor } from '../src/context-graph/summary-compressor.js';
import { PatternCompressor } from '../src/context-graph/pattern-compressor.js';
import { RuleCompressor } from '../src/context-graph/rule-compressor.js';
import { ConflictDetector } from '../src/context-graph/conflict-detector.js';
import { ConflictReflector } from '../src/context-graph/conflict-reflector.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { KnowledgeProjectionMaterializer } from '../src/projections/knowledge-projection.js';
import { MetabolismEngine } from '../src/metabolism/metabolism-engine.js';
import { Embedder } from '../src/processing/embedder.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  MetabolismRunStatus,
  MetabolismStage,
  ProjectionTarget,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('MetabolismEngine', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let engine: MetabolismEngine;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    const embedder = new Embedder('');
    const projector = new GraphKnowledgeProjector(graphStore);
    engine = new MetabolismEngine({
      graphStore,
      summaryCompressor: new SummaryCompressor(graphStore, embedder),
      patternCompressor: new PatternCompressor(graphStore, embedder),
      ruleCompressor: new RuleCompressor(graphStore, embedder),
      conflictDetector: new ConflictDetector(graphStore, embedder),
      conflictReflector: new ConflictReflector(graphStore),
      projectionMaterializer: new KnowledgeProjectionMaterializer(graphStore, projector),
    });

    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot A',
      content: 'Summary: Fixed hydration mismatch in SSR rendering flow.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Session snapshot B',
      content: 'Summary: Resolved hydration mismatch in SSR rendering path.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
    });
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('records a metabolism run with stage stats and projection records', async () => {
    const run = await engine.run({ project: 'mindstrate', trigger: 'manual' });

    expect(run.status).toBe(MetabolismRunStatus.COMPLETED);
    expect(run.stageStats[MetabolismStage.COMPRESS]).toBeDefined();
    expect(run.stageStats[MetabolismStage.PRUNE]).toBeDefined();
    expect(run.notes?.some((note) => note.includes('projectionRecords='))).toBe(true);

    const runs = graphStore.listMetabolismRuns({ project: 'mindstrate' });
    expect(runs).toHaveLength(1);
    expect(graphStore.listProjectionRecords({ target: ProjectionTarget.KNOWLEDGE_UNIT }).length).toBeGreaterThan(0);
  });
});
