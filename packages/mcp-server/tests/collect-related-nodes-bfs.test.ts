/**
 * Regression tests for collectRelatedNodes BFS-order output.
 *
 * Before: `nodes.filter((node) => selected.has(node.id))` returned the
 * matched nodes in the source `nodes` order, which was
 * `updated_at DESC` from SQLite. On a real project graph, a deep file
 * like `metabolism/scheduler.ts` reaches hundreds of nodes within two
 * hops via imports + project-containment edges. Sorting that pool by
 * "most recently updated" floated README.md / tsconfig.base.json /
 * web-ui/i18n to the top and drowned out the actual semantic
 * neighbours (`metabolism/compressor.ts`, `metabolism/digest-engine.ts`,
 * ...). The fix returns BFS-order (seeds first, then 1-hop, then
 * 2-hop), tie-broken by `qualityScore`.
 */

import { describe, expect, it } from 'vitest';
import { collectRelatedNodes } from '../src/tools/project-graph-handler-utils.js';
import { projectGraphNode, projectGraphEdge } from './fake-mcp-api.js';

describe('collectRelatedNodes — BFS ordering', () => {
  it('returns seeds first, then 1-hop neighbours, then 2-hop', async () => {
    const seed = projectGraphNode({ id: 'seed', title: 'scheduler.ts' });
    const hop1A = projectGraphNode({ id: 'hop1A', title: 'compressor.ts' });
    const hop1B = projectGraphNode({ id: 'hop1B', title: 'digest-engine.ts' });
    const hop2 = projectGraphNode({ id: 'hop2', title: 'far-away.ts' });
    const unrelated = projectGraphNode({ id: 'noise', title: 'README.md' });

    const nodes = [seed, hop1A, hop1B, hop2, unrelated];
    const edges = [
      projectGraphEdge({ sourceId: seed.id, targetId: hop1A.id }),
      projectGraphEdge({ sourceId: seed.id, targetId: hop1B.id }),
      projectGraphEdge({ sourceId: hop1A.id, targetId: hop2.id }),
    ];

    const result = collectRelatedNodes(nodes, edges, [seed], 2);

    expect(result.map((n) => n.id)).toEqual(['seed', 'hop1A', 'hop1B', 'hop2']);
    expect(result.map((n) => n.id)).not.toContain('noise');
  });

  it('does NOT use the source-array ordering (updated_at DESC) for matched nodes', async () => {
    // The seed is the LAST node in the input array; in the old
    // implementation, the README would still come first because
    // `nodes.filter(...)` preserved that order. The new implementation
    // must put the seed first.
    const readme = projectGraphNode({ id: 'readme', title: 'README.md' });
    const hop1 = projectGraphNode({ id: 'hop1', title: 'compressor.ts' });
    const seed = projectGraphNode({ id: 'seed', title: 'scheduler.ts' });

    const nodes = [readme, hop1, seed]; // updated_at DESC ordering
    const edges = [
      projectGraphEdge({ sourceId: seed.id, targetId: hop1.id }),
    ];

    const result = collectRelatedNodes(nodes, edges, [seed], 1);

    expect(result[0].id).toBe('seed');
    expect(result[1].id).toBe('hop1');
    expect(result.map((n) => n.id)).not.toContain('readme');
  });
});
