/**
 * Node embedding backfill.
 *
 * Generates and stores vector embeddings for context-graph nodes so the
 * hybrid knowledge search and the priority selector's vector score have
 * something to read. Project-graph FILE / DEPENDENCY / MODULE nodes are
 * written by the scanner without embeddings (see `graph-writer.ts`); this
 * pass closes that gap after the deterministic graph + LLM enrichment are
 * in place, so the embed text picks up enriched titles/summaries too.
 *
 * Incremental by construction: nodes that already have an embedding for the
 * active model are skipped, so re-running after a partial or interrupted
 * scan is cheap. Embedding happens in bounded batches to keep API request
 * sizes (OpenAI) and peak memory (offline hash) reasonable on large graphs.
 */

import {
  ContextNodeStatus,
  PROJECT_GRAPH_METADATA_KEYS,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';
import type { Embedder } from '../processing/embedder.js';
import type { NodeVectorIndex, NodeVectorRecord } from './node-vector-index.js';

export interface BackfillNodeEmbeddingsInput {
  project?: string;
  /** Re-embed every node, ignoring existing embeddings (rebuild path). */
  force?: boolean;
  /** Nodes embedded per batch. Defaults to 64. */
  batchSize?: number;
  /** Progress callback, fired once per committed batch. */
  onProgress?: (progress: { embedded: number; total: number }) => void;
  /**
   * Optional search index to mirror embeddings into (e.g. Qdrant). The SQLite
   * store is always written; this keeps an external ANN index in sync. Mirror
   * failures are swallowed by the index itself so a backfill never fails on it.
   */
  vectorIndex?: NodeVectorIndex;
}

export interface BackfillNodeEmbeddingsResult {
  model: string;
  dimensions: number;
  candidates: number;
  embedded: number;
  skipped: number;
}

/** Statuses worth embedding — same set the search/selector consider live. */
const EMBEDDABLE_STATUSES = new Set<ContextNodeStatus>([
  ContextNodeStatus.ACTIVE,
  ContextNodeStatus.VERIFIED,
  ContextNodeStatus.CANDIDATE,
]);

export const backfillNodeEmbeddings = async (
  store: ContextGraphStore,
  embedder: Embedder,
  model: string,
  input: BackfillNodeEmbeddingsInput = {},
): Promise<BackfillNodeEmbeddingsResult> => {
  const batchSize = Math.max(input.batchSize ?? 64, 1);
  const statuses = Array.from(EMBEDDABLE_STATUSES);

  // `force` re-embeds everything; otherwise the DB-side anti-join skips nodes
  // already embedded for this model, so we never hold every embedded id in a
  // JS Set. `total`/`candidates` are counted, not derived from a materialized
  // list — the whole point is to never load the full node set at once.
  const excludeModel = input.force ? undefined : model;
  const total = store.countEmbeddableNodes({ project: input.project, statuses, excludeModel });
  const candidates = store.countEmbeddableNodes({ project: input.project, statuses });

  const result: BackfillNodeEmbeddingsResult = {
    model,
    dimensions: embedder.getEmbeddingDimension(),
    candidates,
    embedded: 0,
    skipped: candidates - total,
  };

  // Keyset pagination by primary key: peak memory is O(batchSize), not
  // O(node count). A 100k-node graph that OOM-crashed the 512MB team-server on
  // the old `list({ limit: 100000 })` load now streams through cleanly.
  //
  // `afterId` advances past the last id every batch in BOTH modes, so it is
  // strictly increasing and the loop is guaranteed to terminate. The
  // `excludeModel` anti-join is only an optimization layered on top: it drops
  // already-embedded nodes out of the forward scan (incremental re-runs), while
  // the cursor still guarantees we never revisit a node we just processed.
  let afterId: string | undefined;
  for (;;) {
    const batch = store.listEmbeddableNodesPage({
      statuses,
      project: input.project,
      afterId,
      excludeModel,
      limit: batchSize,
    });
    if (batch.length === 0) break;

    const texts = batch.map((node) => nodeEmbeddingText(node));
    const embeddings = await embedder.embedBatch(texts);
    const mirror: NodeVectorRecord[] = [];
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      store.upsertNodeEmbedding({
        nodeId: batch[j].id,
        model,
        dimensions: embedding.length,
        embedding,
        text: texts[j],
      });
      mirror.push({ nodeId: batch[j].id, project: batch[j].project, model, embedding });
      result.embedded++;
    }
    if (input.vectorIndex) await input.vectorIndex.upsert(mirror);
    input.onProgress?.({ embedded: result.embedded, total });

    afterId = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  return result;
};

/**
 * Build the text a node is embedded from. Field order mirrors the lexical
 * search weighting (title > sourceRef/tags > body): the title and path of a
 * file node carry the most signal, while the `kind:` line distinguishes a
 * `file` from a `dependency` with the same label. Project-graph nodes have
 * thin `content` (`"file: <label>"`), so the path + tags + kind are what
 * make them semantically addressable.
 */
export const nodeEmbeddingText = (node: ContextNode): string => {
  const parts: string[] = [node.title];
  const kind = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind];
  if (typeof kind === 'string' && kind) parts.push(`kind: ${kind}`);
  if (node.sourceRef) parts.push(node.sourceRef);
  if (node.tags.length > 0) parts.push(node.tags.join(' '));
  if (node.content && node.content !== node.title) parts.push(node.content);
  return parts.join('\n');
};
