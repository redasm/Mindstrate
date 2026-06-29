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
import { PROJECT_GRAPH_DEFAULT_QUERY_LIMIT } from '@mindstrate/protocol/models';

export interface BackfillNodeEmbeddingsInput {
  project?: string;
  /** Re-embed every node, ignoring existing embeddings (rebuild path). */
  force?: boolean;
  /** Nodes embedded per batch. Defaults to 64. */
  batchSize?: number;
  /** Progress callback, fired once per committed batch. */
  onProgress?: (progress: { embedded: number; total: number }) => void;
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
  const nodes = store
    .listNodes({ project: input.project, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter((node) => EMBEDDABLE_STATUSES.has(node.status));

  const already = input.force ? new Set<string>() : store.nodeIdsWithEmbedding(model);
  const pending = nodes.filter((node) => !already.has(node.id));

  const result: BackfillNodeEmbeddingsResult = {
    model,
    dimensions: embedder.getEmbeddingDimension(),
    candidates: nodes.length,
    embedded: 0,
    skipped: nodes.length - pending.length,
  };

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const texts = batch.map((node) => nodeEmbeddingText(node));
    const embeddings = await embedder.embedBatch(texts);
    for (let j = 0; j < batch.length; j++) {
      const embedding = embeddings[j];
      store.upsertNodeEmbedding({
        nodeId: batch[j].id,
        model,
        dimensions: embedding.length,
        embedding,
        text: texts[j],
      });
      result.embedded++;
    }
    input.onProgress?.({ embedded: result.embedded, total: pending.length });
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
