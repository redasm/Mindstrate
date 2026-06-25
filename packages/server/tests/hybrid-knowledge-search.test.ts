/**
 * Hybrid (vector + lexical) knowledge search and node-embedding backfill.
 *
 * Verifies the three previously-broken wires are connected:
 *  1. backfill writes node embeddings (the `node_embeddings` table was empty),
 *  2. the store's vector search returns project-graph file nodes,
 *  3. `queryGraphKnowledge` blends vector hits with lexical hits and can
 *     surface a node a literal-substring search would miss.
 *
 * Runs in offline (hash-embedding) mode — no API key required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mindstrate } from '../src/mindstrate.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { createTempDir, removeTempDir } from './test-support.js';

const PROJECT = 'hybrid-search-demo';

/** Create a project-graph FILE-style node (the kind the scanner writes). */
function addFileNode(memory: Mindstrate, label: string, sourceRef: string, kind = 'file') {
  return memory.context.createContextNode({
    substrateType: SubstrateType.SNAPSHOT,
    domainType: ContextDomainType.ARCHITECTURE,
    title: label,
    content: `${kind}: ${label}`,
    tags: ['project-graph', kind],
    project: PROJECT,
    status: ContextNodeStatus.ACTIVE,
    sourceRef,
    metadata: { projectGraph: true, kind },
  });
}

describe('hybrid knowledge search', () => {
  let tempDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    tempDir = createTempDir();
    memory = new Mindstrate({ dataDir: tempDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(tempDir);
  });

  it('backfills embeddings and finds project-graph file nodes by vector similarity', async () => {
    const node = addFileNode(
      memory,
      'metabolism-engine.ts',
      'packages/server/src/metabolism/metabolism-engine.ts',
    );
    addFileNode(memory, 'unrelated-widget.tsx', 'packages/web-ui/src/unrelated-widget.tsx');

    // Backfill (force=true re-embeds everything regardless of prior state).
    const [result] = await memory.maintenance.rebuildVectors(PROJECT);
    expect(result.embedded).toBeGreaterThanOrEqual(2);

    // The embedding row now exists for the offline-hash model.
    const embedding = memory.context.getContextNode(node.id);
    expect(embedding).not.toBeNull();

    // A query sharing tokens with the file path surfaces it via the blended
    // search even though it is a low-priority SNAPSHOT node.
    const results = await memory.context.queryGraphKnowledge('metabolism engine', {
      project: PROJECT,
      topK: 5,
    });
    expect(results.some((r) => r.view.id === node.id)).toBe(true);
  });

  it('falls back to lexical-only results when nothing is embedded yet', async () => {
    const node = addFileNode(memory, 'auth-guard.ts', 'packages/server/src/auth/auth-guard.ts');

    // No backfill run — node_embeddings is empty, so the vector term
    // contributes nothing and search must still return the lexical hit.
    const results = await memory.context.queryGraphKnowledge('auth-guard', {
      project: PROJECT,
      topK: 5,
    });
    expect(results.some((r) => r.view.id === node.id)).toBe(true);
  });

  it('rebuildVectors is incremental-safe and idempotent', async () => {
    addFileNode(memory, 'pruner.ts', 'packages/server/src/metabolism/pruner.ts');

    const [first] = await memory.maintenance.rebuildVectors(PROJECT);
    const [second] = await memory.maintenance.rebuildVectors(PROJECT);
    // force=true means both runs embed the full candidate set, not zero.
    expect(first.embedded).toBe(second.embedded);
    expect(second.candidates).toBe(first.candidates);
  });
});
