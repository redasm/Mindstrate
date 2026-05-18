/**
 * Regression tests for the path-aware task query seed selector.
 *
 * Before this selector existed, `handleProjectGraphTaskQuery` ran a
 * raw `title.toLowerCase().includes(query)` filter — which returned an
 * empty `matching` set for deep paths like
 * `packages/server/src/metabolism/scheduler.ts`, then
 * `selectTaskNodes -> collectRelatedNodes` walked the graph with empty
 * seeds and the report fell through to a default slice of nodes. That
 * is how `before-edit` / `impact` ended up "matching" README.md,
 * tsconfig.base.json, and web-ui/i18n for unrelated deep paths.
 *
 * These tests pin the fix:
 *   1. A path query matches title / sourceRef / evidence-path exactly,
 *      not by substring.
 *   2. A path query that does not match anything returns an empty seed
 *      set (the report builder is expected to render "no matching
 *      nodes" rather than fabricate a default slice).
 *   3. A free-form natural-language query still uses substring matching
 *      against title / id (the legacy behavior is preserved for
 *      queries that obviously are not paths).
 */

import { describe, expect, it } from 'vitest';
import { collectTaskQuerySeeds, looksLikeFilePath } from '../src/tools/project-graph-handler-utils.js';
import { projectGraphNode } from './fake-mcp-api.js';

describe('looksLikeFilePath', () => {
  it('treats anything with a slash and no whitespace as a path', () => {
    expect(looksLikeFilePath('packages/server/src/metabolism/scheduler.ts')).toBe(true);
    expect(looksLikeFilePath('packages\\server\\src\\file.ts')).toBe(true);
  });

  it('treats free-form natural language as not-a-path', () => {
    expect(looksLikeFilePath('refactor the scheduler')).toBe(false);
    expect(looksLikeFilePath('代谢引擎重构')).toBe(false);
  });

  it('treats undefined / empty as not-a-path', () => {
    expect(looksLikeFilePath(undefined)).toBe(false);
    expect(looksLikeFilePath('')).toBe(false);
  });
});

describe('collectTaskQuerySeeds', () => {
  const nodes = [
    projectGraphNode({
      id: 'pg:demo:file:scheduler',
      title: 'packages/server/src/metabolism/scheduler.ts',
      evidencePaths: ['packages/server/src/metabolism/scheduler.ts'],
    }),
    projectGraphNode({
      id: 'pg:demo:file:tsconfig',
      title: 'tsconfig.base.json',
      evidencePaths: ['tsconfig.base.json'],
    }),
    projectGraphNode({
      id: 'pg:demo:file:readme',
      title: 'README.md',
      evidencePaths: ['README.md'],
    }),
    projectGraphNode({
      id: 'pg:demo:component:Scheduler',
      title: 'Scheduler',
      evidencePaths: ['packages/repo-scanner/src/scheduler.ts'],
    }),
  ];

  it('matches a deep path against title exactly, ignoring unrelated global-hot nodes', () => {
    const seeds = collectTaskQuerySeeds(nodes, 'packages/server/src/metabolism/scheduler.ts');
    expect(seeds.map((node) => node.id)).toEqual(['pg:demo:file:scheduler']);
  });

  it('also matches against evidence paths so component nodes anchored on the path show up', () => {
    const seeds = collectTaskQuerySeeds(nodes, 'packages/repo-scanner/src/scheduler.ts');
    expect(seeds.map((node) => node.id)).toEqual(['pg:demo:component:Scheduler']);
  });

  it('returns empty when a path query has no graph match — never falls back to substring search', () => {
    // Prior behavior used to fall through and pick README.md / tsconfig
    // because the report builder needed *something*. The selector
    // refuses to do that — empty seeds means the report builder can
    // honestly say "this path is not in the graph".
    const seeds = collectTaskQuerySeeds(nodes, 'packages/does/not/exist.ts');
    expect(seeds).toEqual([]);
  });

  it('treats free-form natural-language queries with substring matching against title and id', () => {
    const seeds = collectTaskQuerySeeds(nodes, 'scheduler');
    expect(seeds.map((node) => node.id)).toContain('pg:demo:file:scheduler');
    expect(seeds.map((node) => node.id)).toContain('pg:demo:component:Scheduler');
  });

  it('returns empty for missing / empty query', () => {
    expect(collectTaskQuerySeeds(nodes, undefined)).toEqual([]);
    expect(collectTaskQuerySeeds(nodes, '')).toEqual([]);
  });
});
