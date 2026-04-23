import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch } from '../src/context-graph/projected-knowledge-search.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('ProjectedKnowledgeSearch', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;
  let search: ProjectedKnowledgeSearch;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'context-graph.db'));
    const projector = new GraphKnowledgeProjector(graphStore);
    search = new ProjectedKnowledgeSearch(projector);
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('returns projected rule nodes ranked by relevance', () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Hydration Safety Rule',
      content: 'Use hydration-safe SSR and avoid browser-only checks during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 90,
      confidence: 0.9,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Database Summary',
      content: 'Connection pool tuning summary.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 70,
      confidence: 0.8,
    });

    const results = search.search('hydration safe SSR', {
      project: 'mindstrate',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].view.title).toBe('Hydration Safety Rule');
    expect(results[0].matchReason).toContain('Projected rule');
  });
});
