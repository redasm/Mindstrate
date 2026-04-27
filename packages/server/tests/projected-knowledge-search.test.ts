import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch } from '../src/context-graph/projected-knowledge-search.js';
import { createTempDir, removeTempDir } from './helpers.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
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
    search = new ProjectedKnowledgeSearch(projector, graphStore);
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

  it('excludes conflicted nodes unless explicitly requested', () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Conflicted Hydration Rule',
      content: 'Use hydration-safe SSR.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });

    expect(search.search('hydration SSR', { project: 'mindstrate' })).toHaveLength(0);
    expect(search.search('hydration SSR', {
      project: 'mindstrate',
      includeStatuses: [ContextNodeStatus.CONFLICTED],
    })).toHaveLength(1);
  });

  it('promotes high-level nodes supported by relevant lower-level evidence', () => {
    const rule = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'SSR Browser API Rule',
      content: 'Do not branch on browser APIs during render.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 90,
      confidence: 0.9,
    });
    const summary = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: 'Hydration mismatch evidence',
      content: 'Hydration mismatch came from a browser API branch.',
      project: 'mindstrate',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 70,
      confidence: 0.8,
    });
    graphStore.createEdge({
      sourceId: summary.id,
      targetId: rule.id,
      relationType: ContextRelationType.SUPPORTS,
      strength: 1,
    });

    const results = search.search('hydration mismatch', {
      project: 'mindstrate',
      topK: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].view.id).toBe(rule.id);
    expect(results[0].matchReason).toContain('supported by related summary');
  });
});
