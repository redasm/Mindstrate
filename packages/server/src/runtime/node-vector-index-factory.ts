import type { MindstrateConfig } from '../config.js';
import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import {
  QdrantNodeVectorIndex,
  SqliteNodeVectorIndex,
  type NodeVectorIndex,
} from '../context-graph/node-vector-index.js';

/**
 * Build the {@link NodeVectorIndex} the knowledge search + embedding writes use.
 *
 * `local` (default) → in-process SQLite dot-product scan.
 * `qdrant`          → Qdrant ANN with the SQLite scan as its fallback, so a
 *                     Qdrant outage degrades latency rather than breaking search.
 *
 * A single collection spans all projects (payload-filtered) because
 * `memory_search` with no project scope must reach every project's nodes.
 * Dimension is taken from the default provider; embeddings from other-dimension
 * models simply won't match at query time (same contract as the SQLite scan).
 */
export function createNodeVectorIndex(
  config: MindstrateConfig,
  providerFactory: ProviderFactory,
  store: ContextGraphStore,
  warn?: (message: string) => void,
): NodeVectorIndex {
  const sqlite = new SqliteNodeVectorIndex(store);
  if (config.vectorBackend !== 'qdrant') return sqlite;

  const providers = providerFactory.forProject('');
  return new QdrantNodeVectorIndex({
    url: config.qdrantUrl ?? '',
    apiKey: config.qdrantApiKey,
    collectionName: `${config.collectionName}-nodes`,
    dimension: providers.embeddingDim,
    fallback: sqlite,
    warn,
  });
}
