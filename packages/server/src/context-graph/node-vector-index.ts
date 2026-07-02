/**
 * Pluggable similarity-search index over context-graph node embeddings.
 *
 * The SQLite `node_embeddings` table stays the source of truth either way — the
 * priority selector reads single vectors from it, and rebuilds re-embed into it.
 * This abstraction is only about *how the KNN scan runs*:
 *
 *  - {@link SqliteNodeVectorIndex} scores candidates in JS (dot product over
 *    normalized Float32 rows). Zero dependencies, fine to ~tens of thousands of
 *    nodes per project; the default for local installs.
 *  - {@link QdrantNodeVectorIndex} offloads the KNN to Qdrant's ANN index for
 *    graphs too large to scan in-process. It is an *accelerator*: node vectors
 *    are double-written to a Qdrant collection, but every search falls back to
 *    the SQLite scan if Qdrant is unreachable, so a Qdrant outage degrades
 *    latency, not correctness.
 */

import type { ContextGraphStore } from './context-graph-store.js';

export interface NodeVectorQuery {
  queryEmbedding: number[];
  model: string;
  project?: string;
  statuses?: string[];
  topK: number;
  minScore: number;
}

export interface NodeVectorHit {
  nodeId: string;
  score: number;
}

/** One node's vector, as written by the backfill/rebuild path. */
export interface NodeVectorRecord {
  nodeId: string;
  project?: string;
  model: string;
  embedding: number[];
}

export interface NodeVectorIndex {
  search(query: NodeVectorQuery): Promise<NodeVectorHit[]>;
  /** Mirror embeddings into the index (no-op when the store is authoritative). */
  upsert(records: NodeVectorRecord[]): Promise<void>;
  /** Drop a project's vectors from the index (no-op for the SQLite index). */
  deleteForProject(project: string): Promise<void>;
}

/**
 * Default index: delegate to the store's in-process dot-product scan. The store
 * already owns the vectors, so upsert/delete are handled by the normal
 * `node_embeddings` writes and there is nothing extra to mirror here.
 */
export class SqliteNodeVectorIndex implements NodeVectorIndex {
  constructor(private readonly store: ContextGraphStore) {}

  async search(query: NodeVectorQuery): Promise<NodeVectorHit[]> {
    return this.store.searchSimilarNodes({
      queryEmbedding: query.queryEmbedding,
      model: query.model,
      project: query.project,
      statuses: query.statuses,
      topK: query.topK,
      minScore: query.minScore,
    });
  }

  async upsert(): Promise<void> {
    /* store is authoritative — nothing to mirror */
  }

  async deleteForProject(): Promise<void> {
    /* store row deletion handles this */
  }
}

interface QdrantNodePoint {
  id?: string;
  score?: number;
  payload?: { nodeId?: string };
}

export interface QdrantNodeVectorIndexOptions {
  url: string;
  apiKey?: string;
  collectionName: string;
  dimension: number;
  /** Used when Qdrant is unreachable so search degrades to latency, not errors. */
  fallback: NodeVectorIndex;
  /** Structured logger; failures are warned, never thrown to the caller. */
  warn?: (message: string) => void;
}

/**
 * Qdrant-backed KNN with SQLite fallback. Uses a single collection across
 * projects (payload-filtered by `project` + `model`), because `memory_search`
 * with no project scope must reach every project's nodes — a per-project
 * collection can't answer that in one query. Node ids are arbitrary strings
 * (e.g. `pg:demo:file:...`) but Qdrant point ids must be UUID/uint, so the
 * point id is a deterministic UUIDv5-style hash of `model:nodeId` and the real
 * id rides in the payload.
 */
export class QdrantNodeVectorIndex implements NodeVectorIndex {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly collectionName: string;
  private readonly dimension: number;
  private readonly fallback: NodeVectorIndex;
  private readonly warn: (message: string) => void;
  private ensured = false;

  constructor(options: QdrantNodeVectorIndexOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.collectionName = options.collectionName;
    this.dimension = options.dimension;
    this.fallback = options.fallback;
    this.warn = options.warn ?? (() => {});
  }

  async search(query: NodeVectorQuery): Promise<NodeVectorHit[]> {
    try {
      await this.ensureCollection();
      // Filter by model + project only. Status is deliberately NOT filtered
      // here: a node's status can change without re-embedding, so a status
      // payload would drift stale. The search layer re-checks status downstream
      // (`viewForNode` / the projector's own status filter), so the worst case
      // is a few extra candidates that get dropped after the fact.
      const must: Array<Record<string, unknown>> = [
        { key: 'model', match: { value: query.model } },
      ];
      if (query.project) {
        must.push({ key: 'project', match: { value: query.project.toLowerCase() } });
      }
      const response = await this.request<{ result?: QdrantNodePoint[] }>(
        `/collections/${encodeURIComponent(this.collectionName)}/points/search`,
        {
          method: 'POST',
          body: JSON.stringify({
            vector: query.queryEmbedding,
            limit: query.topK,
            with_payload: true,
            score_threshold: query.minScore,
            filter: { must },
          }),
        },
      );
      return (response.result ?? [])
        .map((point) => ({ nodeId: point.payload?.nodeId ?? '', score: point.score ?? 0 }))
        .filter((hit) => hit.nodeId !== '');
    } catch (error) {
      this.warn(
        `Qdrant node search failed, falling back to SQLite scan: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallback.search(query);
    }
  }

  async upsert(records: NodeVectorRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
      await this.ensureCollection();
      await this.request(
        `/collections/${encodeURIComponent(this.collectionName)}/points?wait=true`,
        {
          method: 'PUT',
          body: JSON.stringify({
            points: records.map((record) => ({
              id: pointId(record.model, record.nodeId),
              vector: record.embedding,
              payload: {
                nodeId: record.nodeId,
                model: record.model,
                project: record.project?.toLowerCase() ?? '',
              },
            })),
          }),
        },
      );
    } catch (error) {
      // A mirror-write failure is not fatal: the SQLite table still has the
      // vector, so search falls back correctly. Warn so drift is visible.
      this.warn(
        `Qdrant node upsert failed (${records.length} vectors); SQLite fallback still valid: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async deleteForProject(project: string): Promise<void> {
    try {
      await this.ensureCollection();
      await this.request(
        `/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: { must: [{ key: 'project', match: { value: project.toLowerCase() } }] },
          }),
        },
      );
    } catch (error) {
      this.warn(
        `Qdrant node delete for project "${project}" failed: `
          + `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async ensureCollection(): Promise<void> {
    if (this.ensured) return;
    await this.request(`/collections/${encodeURIComponent(this.collectionName)}`, {
      method: 'PUT',
      body: JSON.stringify({ vectors: { size: this.dimension, distance: 'Cosine' } }),
    });
    this.ensured = true;
  }

  private async request<T = unknown>(pathname: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['api-key'] = this.apiKey;
    const response = await fetch(`${this.baseUrl}${pathname}`, { ...init, headers });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Qdrant request failed: ${response.status} ${body}`.trim());
    }
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  }
}

/**
 * Deterministic UUID (RFC 4122 v5-shaped) from `model:nodeId`. Qdrant accepts
 * unsigned ints or UUID strings as point ids; graph node ids are neither, so
 * we hash them into a stable UUID and carry the real id in the payload. Same
 * input always yields the same point id, so re-embeds upsert in place.
 */
function pointId(model: string, nodeId: string): string {
  const hash = fnv1a128(`${model}:${nodeId}`);
  // Force the version (5) and variant nibbles so Qdrant treats it as a UUID.
  const bytes = hash.split('');
  bytes[12] = '5';
  bytes[16] = '8';
  const hex = bytes.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** 128-bit FNV-1a as 32 hex chars — enough spread for point-id uniqueness. */
function fnv1a128(input: string): string {
  // Two independent 64-bit-ish FNV passes (different offsets) concatenated,
  // computed in 32-bit chunks to stay within JS safe integers.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
  // Repeat to fill 32 hex chars deterministically.
  return (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2) >>> 0)).slice(0, 32);
}
