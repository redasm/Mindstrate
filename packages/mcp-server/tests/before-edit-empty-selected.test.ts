/**
 * Regression tests for the empty-selected branch of buildBeforeEditReport.
 *
 * Real-world transcripts showed that when `selectTaskNodes` returned
 * no matches (e.g. the user asked about a file that is not yet in the
 * project graph), the report still rendered a "Found 0 project graph
 * node(s)." line with the standard "Suggested next queries" footer —
 * indistinguishable from a successful empty search and unhelpful to
 * the agent trying to diagnose what went wrong.
 *
 * The handler now emits an explicit diagnostic listing the three most
 * common causes so the AI can either reindex, fix its query, or
 * correct the project slug instead of guessing.
 */

import { describe, expect, it } from 'vitest';
import { buildBeforeEditReport } from '../src/tools/project-graph-task-report.js';

describe('buildBeforeEditReport — empty selected', () => {
  it('renders an explicit diagnostic block when no graph node matched the path query', () => {
    const text = buildBeforeEditReport({
      task: 'before-edit',
      query: 'packages/never/existed.ts',
      nodes: [],
      edges: [],
      selected: [],
      evidence: [],
      overlays: [],
      systemPageRules: [],
      limit: 10,
    });

    expect(text).toContain('Found 0 project graph node(s).');
    expect(text).toContain('packages/never/existed.ts');
    expect(text).toContain('reindex_project_graph');
    expect(text).toContain('project graph was indexed under a different project slug');
    // Make sure the report still has the rest of its structure intact.
    expect(text).toContain('### Classification');
    expect(text).toContain('### Recommended Verification');
  });

  it('falls back to "(no query)" diagnostic when query is missing', () => {
    const text = buildBeforeEditReport({
      task: 'before-edit',
      query: undefined,
      nodes: [],
      edges: [],
      selected: [],
      evidence: [],
      overlays: [],
      systemPageRules: [],
      limit: 10,
    });

    expect(text).toContain('No graph node matched **(no query)**');
  });

  it('does NOT show the diagnostic when selected is non-empty', () => {
    const text = buildBeforeEditReport({
      task: 'before-edit',
      query: 'packages/server/src/feature.ts',
      nodes: [],
      edges: [],
      selected: [{
        id: 'pg:demo:file:feature',
        title: 'packages/server/src/feature.ts',
        substrateType: 'snapshot' as never,
        domainType: 'architecture' as never,
        status: 'active' as never,
        content: '',
        tags: [],
        confidence: 0.8,
        qualityScore: 80,
        compressionLevel: 1,
        accessCount: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }],
      evidence: ['packages/server/src/feature.ts'],
      overlays: [],
      systemPageRules: [],
      limit: 10,
    });

    expect(text).not.toContain('No graph node matched');
    expect(text).toContain('Found 1 project graph node');
  });
});
