/**
 * End-to-end test of the feedback co-occurrence compressor — the
 * "Curator" step that closes ACE's
 *   surfaced ⟶ AI used ⟶ feedback ⟶ compressed PATTERN
 * loop. Without this step, project graph nodes never get promoted into
 * the substrate (`PATTERN`) that `ContextPrioritySelector` actually
 * picks from, so the relationship network only ever shows up via the
 * direct project-graph traversal in `assembleContext`.
 *
 * Verifies, end-to-end, that:
 *  1. Two AI sessions surface the same pair of project graph nodes,
 *  2. The AI reports both as `adopted` via `memory_feedback_auto`,
 *  3. `runFeedbackCooccurrenceCompression` materializes one
 *     `PATTERN + ARCHITECTURE` node, with `SUPPORTS` edges pointing back
 *     to each source project graph node,
 *  4. The next call to `assembleContext` surfaces the new PATTERN
 *     through `ContextPrioritySelector` (the Repeated Patterns section
 *     in the assembled summary), proving the loop is closed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  ContextRelationType,
  PROJECT_GRAPH_METADATA_KEYS,
  SubstrateType,
} from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('feedback co-occurrence compressor', () => {
  let projectRoot: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    projectRoot = createTempDir('mindstrate-cooccurrence-');
    dataDir = createTempDir('mindstrate-cooccurrence-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();

    fs.writeFileSync(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'cooccurrence-demo' }),
    );
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'App.tsx'),
      [
        'import { format } from "./format";',
        'export function App() { return format(0); }',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'format.ts'),
      'export const format = (value: number): string => `count=${value}`;',
    );
    const project = detectProject(projectRoot);
    memory.context.indexProjectGraph(project!);
  });

  afterEach(() => {
    memory.close();
    removeTempDir(projectRoot);
    removeTempDir(dataDir);
  });

  it('compresses repeatedly co-used project graph nodes into a PATTERN with SUPPORTS edges back', async () => {
    const projectGraphNodes = memory.context.listContextNodes({
      project: 'cooccurrence-demo',
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 200,
    }).filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true);
    const appFile = projectGraphNodes.find((node) => node.title.endsWith('App.tsx'));
    const formatFile = projectGraphNodes.find((node) => node.title.endsWith('format.ts'));
    expect(appFile).toBeDefined();
    expect(formatFile).toBeDefined();

    // Simulate three AI sessions surfacing both nodes and reporting both
    // as `adopted`. Three crosses the default `minCoOccurrence = 3`
    // threshold and is high enough to survive the co-occurrence filter.
    for (let i = 0; i < 3; i++) {
      const sessionId = `session-${i}`;
      const appRetrievalId = (memory as any).services
        ? (memory as any).services.feedbackLoop.trackRetrieval(appFile!.id, 'refactor counter formatting', sessionId)
        : null;
      // The Mindstrate facade does not expose `services` publicly; track
      // through the feedback API path instead.
      const retrievalIdA = trackRetrieval(memory, appFile!.id, sessionId);
      const retrievalIdB = trackRetrieval(memory, formatFile!.id, sessionId);
      memory.context.recordFeedback(retrievalIdA, 'adopted');
      memory.context.recordFeedback(retrievalIdB, 'adopted');
      void appRetrievalId; // keep linter happy regardless of which path was used
    }

    const result = await memory.metabolism.runFeedbackCooccurrenceCompression({
      project: 'cooccurrence-demo',
    });

    expect(result.scannedSessions).toBe(3);
    expect(result.patternNodesCreated).toBe(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].sourceNodeIds.sort()).toEqual([appFile!.id, formatFile!.id].sort());

    const patternNode = memory.context.getContextNode(result.clusters[0].patternNodeId);
    expect(patternNode).not.toBeNull();
    expect(patternNode!.substrateType).toBe(SubstrateType.PATTERN);
    expect(patternNode!.domainType).toBe(ContextDomainType.ARCHITECTURE);
    expect(patternNode!.metadata?.['compressedFromNodeIds']).toEqual(
      expect.arrayContaining([appFile!.id, formatFile!.id]),
    );

    // SUPPORTS edges go PATTERN -> source so `findBestSupportingEvidence`
    // (which queries `listIncomingEdges(view.id, SUPPORTS)`) walks back
    // from the source to the synthesized pattern.
    const supportEdgesFromAppFile = memory.context
      .listContextEdges({ targetId: appFile!.id, relationType: ContextRelationType.SUPPORTS, limit: 20 })
      .filter((edge) => edge.sourceId === patternNode!.id);
    expect(supportEdgesFromAppFile).toHaveLength(1);
    const supportEdgesFromFormatFile = memory.context
      .listContextEdges({ targetId: formatFile!.id, relationType: ContextRelationType.SUPPORTS, limit: 20 })
      .filter((edge) => edge.sourceId === patternNode!.id);
    expect(supportEdgesFromFormatFile).toHaveLength(1);

    // Re-running on the same data is idempotent: same deterministic id,
    // updated-not-created counter increments.
    const second = await memory.metabolism.runFeedbackCooccurrenceCompression({
      project: 'cooccurrence-demo',
    });
    expect(second.patternNodesCreated).toBe(0);
    expect(second.patternNodesUpdated).toBe(1);
    expect(second.clusters[0].patternNodeId).toBe(patternNode!.id);
  });

  it('skips pairs below the co-occurrence threshold', async () => {
    const projectGraphNodes = memory.context.listContextNodes({
      project: 'cooccurrence-demo',
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 200,
    }).filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true);
    const a = projectGraphNodes[0]!;
    const b = projectGraphNodes[1]!;

    // Only 1 co-occurrence (default threshold is 3) ⇒ no pattern.
    const sessionId = 'lonely-session';
    memory.context.recordFeedback(trackRetrieval(memory, a.id, sessionId), 'adopted');
    memory.context.recordFeedback(trackRetrieval(memory, b.id, sessionId), 'adopted');

    const result = await memory.metabolism.runFeedbackCooccurrenceCompression({
      project: 'cooccurrence-demo',
    });

    expect(result.patternNodesCreated).toBe(0);
    expect(result.clusters).toHaveLength(0);
  });

  it('promotes the new PATTERN into the next assembleContext via ContextPrioritySelector', async () => {
    const projectGraphNodes = memory.context.listContextNodes({
      project: 'cooccurrence-demo',
      domainType: ContextDomainType.ARCHITECTURE,
      limit: 200,
    }).filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true);
    const appFile = projectGraphNodes.find((node) => node.title.endsWith('App.tsx'))!;
    const formatFile = projectGraphNodes.find((node) => node.title.endsWith('format.ts'))!;

    for (let i = 0; i < 3; i++) {
      const sessionId = `loop-session-${i}`;
      memory.context.recordFeedback(trackRetrieval(memory, appFile.id, sessionId), 'adopted');
      memory.context.recordFeedback(trackRetrieval(memory, formatFile.id, sessionId), 'adopted');
    }

    const compression = await memory.metabolism.runFeedbackCooccurrenceCompression({
      project: 'cooccurrence-demo',
    });
    expect(compression.patternNodesCreated).toBe(1);
    const patternId = compression.clusters[0].patternNodeId;

    const assembled = await memory.assembly.assembleContext('continue refactor', {
      project: 'cooccurrence-demo',
    });

    // The freshly-compressed PATTERN must show up in graphPatterns —
    // that is what proves `ContextPrioritySelector` (which only looks
    // at RULE/PATTERN/SUMMARY substrate) can now reach the project
    // graph relationship via the compressed surface.
    const patternTitles = assembled.graphPatterns ?? [];
    expect(patternTitles.some((title) => title.startsWith('Co-used:'))).toBe(true);
    expect(assembled.summary).toContain('Repeated Patterns');
    expect(assembled.summary).toMatch(/Co-used:/);

    // And it should also have a retrieval ticket so the AI can keep
    // the loop running across sessions.
    expect(assembled.retrievals?.some((entry) => entry.nodeId === patternId)).toBe(true);
  });
});

/**
 * Mint a retrieval id the same way `assembleContext` does. We can't
 * call `feedbackLoop.trackRetrieval` directly from the test because the
 * Mindstrate facade hides `services`; instead we run the same path the
 * AI runs in production: assembleContext (which mints retrieval ids)
 * surfaces the node, and we read the matching retrieval id back. Here
 * we simulate that minimally by hand-rolling a feedback event row via
 * a tiny shim — the public API already exposes `recordFeedback` keyed
 * by `retrievalId`, but no public way to mint one without going through
 * an assembly. To keep the test focused and fast we reach into the
 * runtime via a known-good cast.
 */
function trackRetrieval(memory: Mindstrate, nodeId: string, sessionId: string): string {
  const services = (memory as unknown as { services: { feedbackLoop: { trackRetrieval: (nodeId: string, query: string, sessionId?: string) => string } } }).services;
  return services.feedbackLoop.trackRetrieval(nodeId, 'co-occurrence test', sessionId);
}
