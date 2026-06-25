import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch } from '../src/context-graph/projected-knowledge-search.js';
import { createTempDir, removeTempDir } from './test-support.js';
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

  it('returns projected rule nodes ranked by relevance', async () => {
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

    const results = await search.search('hydration safe SSR', {
      project: 'mindstrate',
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].view.title).toBe('Hydration Safety Rule');
    expect(results[0].matchReason).toContain('Projected rule');
  });

  it('excludes conflicted nodes unless explicitly requested', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Conflicted Hydration Rule',
      content: 'Use hydration-safe SSR.',
      project: 'mindstrate',
      status: ContextNodeStatus.CONFLICTED,
    });

    expect(await search.search('hydration SSR', { project: 'mindstrate' })).toHaveLength(0);
    expect(await search.search('hydration SSR', {
      project: 'mindstrate',
      includeStatuses: [ContextNodeStatus.CONFLICTED],
    })).toHaveLength(1);
  });

  it('promotes high-level nodes supported by relevant lower-level evidence', async () => {
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

    const results = await search.search('hydration mismatch', {
      project: 'mindstrate',
      topK: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0].view.id).toBe(rule.id);
    expect(results[0].matchReason).toContain('supported by related summary');
  });

  it('matches architecture rules by full content, tags, and source reference', async () => {
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'Generated Files',
      content: 'Generated declarations are not manually edited.\n\nTypeScript/Typing is generated output. Edit C++ reflection source and run UnrealSharp generation.',
      project: 'client',
      status: ContextNodeStatus.VERIFIED,
      tags: ['obsidian-architecture', 'generated-output'],
      sourceRef: 'client/architecture/04-generated-files.md',
      qualityScore: 90,
      confidence: 0.9,
    });

    const results = await search.search('UnrealSharp TypeScript/Typing generated output source of truth', {
      project: 'client',
      topK: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].view.title).toBe('Generated Files');
  });

  it('does not let a small caller limit hide relevant lower-priority candidates', async () => {
    for (let index = 0; index < 8; index += 1) {
      graphStore.createNode({
        substrateType: SubstrateType.AXIOM,
        domainType: ContextDomainType.CONVENTION,
        title: `Unrelated axiom ${index}`,
        content: 'Stable but unrelated operational knowledge.',
        project: 'client',
        status: ContextNodeStatus.VERIFIED,
        qualityScore: 100,
        confidence: 1,
      });
    }
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'Runtime Editor Boundary',
      content: 'Runtime modules must not depend on editor-only modules.',
      project: 'client',
      status: ContextNodeStatus.VERIFIED,
      qualityScore: 80,
      confidence: 0.8,
    });

    const results = await search.search('Runtime editor module boundary', {
      project: 'client',
      limit: 5,
      topK: 3,
    });

    expect(results.map((result) => result.view.title)).toContain('Runtime Editor Boundary');
  });

  it('surfaces project graph nodes by default so graph_knowledge_search reaches file/dependency facts', async () => {
    // Regression: the projector defaults to filtering project graph
    // nodes (so the assembly DAG's "knowledge" slice does not double-list
    // file nodes that already appear under "Project Graph Relationships").
    // The user-facing search tools (`graph_knowledge_search`,
    // `memory_search`) used to inherit that default and silently
    // returned "no relevant graph knowledge" for the most natural
    // queries. The search layer now defaults `includeProjectGraphNodes`
    // back to `true`; callers who want the old behavior pass `false`.
    graphStore.createNode({
      id: 'pg:demo:file:packages/server/src/feature.ts',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'packages/server/src/feature.ts',
      content: 'file: packages/server/src/feature.ts',
      tags: ['project-graph', 'file'],
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      metadata: {
        projectGraph: true,
        kind: 'file',
      },
    });

    const defaultSearch = await search.search('feature.ts', { project: 'demo', topK: 5 });
    expect(defaultSearch.length).toBeGreaterThan(0);
    expect(defaultSearch[0].view.title).toBe('packages/server/src/feature.ts');

    const optedOut = await search.search('feature.ts', {
      project: 'demo',
      topK: 5,
      includeProjectGraphNodes: false,
    });
    expect(optedOut).toHaveLength(0);
  });
});
