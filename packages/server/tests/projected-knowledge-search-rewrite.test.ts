/**
 * Regression tests for the rewritten projected knowledge search scorer.
 *
 * Before this rewrite, `ProjectedKnowledgeSearch` scored every view
 * as `matched_tokens / total_tokens` with substring matching only.
 * That meant:
 *   - A 1-of-3-token hit (33%) tied a 3-of-3 hit (100%) once the
 *     priority blend was applied.
 *   - Short tokens (`set`, `path`) over-triggered, surfacing
 *     unrelated dependency nodes (`setResults`, `usePathname`) when
 *     the user query mentioned long unique terms like
 *     `selectTaskNodes`.
 *   - Title hits had the same weight as body hits.
 *
 * These tests pin the new behavior: field-weighted scoring, word-
 * boundary preference, diversity bonus, and demotion of short
 * tokens.
 */

import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { GraphKnowledgeProjector } from '../src/context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch } from '../src/context-graph/projected-knowledge-search.js';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';

describe('ProjectedKnowledgeSearch - field-weighted scoring', () => {
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

  it('ranks a node with a title-level word match above a body-level substring match for the same token', () => {
    const titleHit = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'path-aware seed selection',
      content: 'Path-aware matchers prefer full paths to substrings.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      confidence: 0.8,
    });
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'usePathname',
      content: 'React router hook that returns the current pathname string.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 65,
      confidence: 0.8,
      metadata: { projectGraph: true, kind: 'dependency' },
    });

    const results = search.search('path matching', { project: 'demo', topK: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].view.id).toBe(titleHit.id);
  });

  it('rewards a node that hits two distinct tokens over one that hits the same token twice', () => {
    const diverseHit = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'metabolism scheduler refactor',
      content: 'Outline for the metabolism / scheduler refactor.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      confidence: 0.8,
    });
    graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'metabolism metabolism metabolism',
      content: 'Repetitive title that hits only one query token, many times.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      confidence: 0.8,
    });

    const results = search.search('metabolism scheduler refactor', { project: 'demo', topK: 5 });
    expect(results[0].view.id).toBe(diverseHit.id);
  });

  it('demotes short tokens so unrelated nodes with the substring do not crowd out true matches', () => {
    graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'setResults',
      content: 'A web-ui setter dependency.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 65,
      confidence: 0.8,
      metadata: { projectGraph: true, kind: 'dependency' },
    });
    const realHit = graphStore.createNode({
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.BUG_FIX,
      title: 'selectTaskNodes path matching regression',
      content: 'Deep path queries failed to match because selectTaskNodes used substring includes only.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 80,
      confidence: 0.85,
    });

    const results = search.search('selectTaskNodes set', { project: 'demo', topK: 5 });
    expect(results[0].view.id).toBe(realHit.id);
  });

  it('still finds a single-token full-word match when nothing else matches', () => {
    const hit = graphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'validation playbook',
      content: 'Run the smallest build/test/lint command covering the change.',
      project: 'demo',
      status: ContextNodeStatus.ACTIVE,
      qualityScore: 90,
      confidence: 0.9,
    });

    const results = search.search('validation', { project: 'demo', topK: 5 });
    expect(results[0].view.id).toBe(hit.id);
    expect(results[0].relevanceScore).toBeGreaterThan(0.5);
  });
});
