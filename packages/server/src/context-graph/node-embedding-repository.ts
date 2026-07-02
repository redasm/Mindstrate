import Database from 'better-sqlite3';
import { l2Normalize } from '../processing/vector-distance.js';

/**
 * Max embedding rows pulled into memory for a single similarity search. Bounds
 * the JS-side cosine scan so a project with a huge graph can't OOM the process
 * (each row is a 1536-float vector that gets JSON-parsed). Override per call via
 * `candidatesForSearch({ limit })` or the env var for larger hosts.
 */
const DEFAULT_SEARCH_CANDIDATE_LIMIT = ((): number => {
  const raw = process.env['MINDSTRATE_VECTOR_CANDIDATE_LIMIT'];
  if (raw === undefined) return 5000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 5000;
  return parsed;
})();

export interface NodeEmbeddingRecord {
  nodeId: string;
  model: string;
  dimensions: number;
  embedding: number[];
  text?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertNodeEmbeddingInput {
  nodeId: string;
  model: string;
  dimensions: number;
  embedding: number[];
  text?: string;
}

export class NodeEmbeddingRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: UpsertNodeEmbeddingInput): NodeEmbeddingRecord {
    const existing = this.get(input.nodeId, input.model);
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? now;

    // Store the L2-normalized vector as a packed Float32 BLOB. The legacy
    // `embedding` TEXT column is NOT NULL, so write an empty array marker
    // rather than the (redundant) JSON — the BLOB is the source of truth now,
    // and duplicating the vector as JSON would negate the storage win.
    const normalized = l2Normalize(input.embedding);
    this.db.prepare(`
      INSERT INTO node_embeddings (
        node_id, model, dimensions, embedding, embedding_vec, text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id, model) DO UPDATE SET
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        embedding_vec = excluded.embedding_vec,
        text = excluded.text,
        updated_at = excluded.updated_at
    `).run(
      input.nodeId,
      input.model,
      input.dimensions,
      '[]',
      packFloat32(normalized),
      input.text ?? null,
      createdAt,
      now,
    );

    return this.get(input.nodeId, input.model)!;
  }

  get(nodeId: string, model: string): NodeEmbeddingRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM node_embeddings WHERE node_id = ? AND model = ?
    `).get(nodeId, model) as NodeEmbeddingRow | undefined;
    if (!row) return null;
    const embedding = this.readRowVector(row);
    return rowToNodeEmbedding(row, embedding);
  }

  /**
   * Node ids that already have an embedding for `model`. The backfill pass
   * uses this to stay incremental: only nodes missing from this set get
   * (re-)embedded, so re-running after a partial scan is cheap.
   */
  nodeIdsWithModel(model: string): Set<string> {
    const rows = this.db.prepare(
      'SELECT node_id FROM node_embeddings WHERE model = ?',
    ).all(model) as Array<{ node_id: string }>;
    return new Set(rows.map((row) => row.node_id));
  }

  /**
   * Candidate vectors for similarity search: every stored embedding for
   * `model` whose node passes the optional project / status filter, joined
   * to the node row so the caller can score and rank without a second
   * round-trip. The caller computes similarity in JS (better-sqlite3 has no
   * vector ops); vectors come back as normalized Float32Array views so the
   * scan is a plain dot product with no per-row JSON parse.
   */
  candidatesForSearch(opts: {
    model: string;
    project?: string;
    statuses?: string[];
    limit?: number;
  }): Array<{ nodeId: string; embedding: Float32Array }> {
    const conditions = ['ne.model = ?'];
    const params: unknown[] = [opts.model];
    if (opts.project) {
      conditions.push('LOWER(n.project) = LOWER(?)');
      params.push(opts.project);
    }
    if (opts.statuses && opts.statuses.length > 0) {
      conditions.push(`n.status IN (${opts.statuses.map(() => '?').join(',')})`);
      params.push(...opts.statuses);
    }
    // Hard cap the candidate pull. A large project graph holds 100k+ embedded
    // nodes; `.all()` over the whole set blew the team-server JS heap and
    // OOM-crashed it on every memory_search. Take the highest-quality rows
    // only — semantic recall doesn't need to scan the entire graph, and the
    // ranking downstream keys off the same quality signal anyway.
    params.push(opts.limit ?? DEFAULT_SEARCH_CANDIDATE_LIMIT);
    const rows = this.db.prepare(`
      SELECT ne.node_id AS node_id, ne.embedding_vec AS embedding_vec, ne.embedding AS embedding
      FROM node_embeddings ne
      JOIN context_nodes n ON n.id = ne.node_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.quality_score DESC, n.updated_at DESC
      LIMIT ?
    `).all(...params) as Array<VectorRow & { node_id: string }>;

    const out: Array<{ nodeId: string; embedding: Float32Array }> = [];
    const migrateBack: Array<{ nodeId: string; blob: Buffer }> = [];
    for (const row of rows) {
      const vec = this.decodeVector(row, migrateBack);
      if (vec) out.push({ nodeId: row.node_id, embedding: vec });
    }
    this.flushLazyMigration(opts.model, migrateBack);
    return out;
  }

  /** Delete all embeddings for a project's nodes (used by rebuild-vectors). */
  deleteForProject(project: string): number {
    const result = this.db.prepare(`
      DELETE FROM node_embeddings
      WHERE node_id IN (
        SELECT id FROM context_nodes WHERE LOWER(project) = LOWER(?)
      )
    `).run(project);
    return result.changes;
  }

  /**
   * Read a single row's vector as a plain `number[]` (the shape callers like
   * the priority selector expect). Prefers the Float32 BLOB; falls back to the
   * legacy TEXT column and migrates that row's BLOB in place so the next read
   * is parse-free.
   */
  private readRowVector(row: VectorRow & { node_id?: string; model?: string }): number[] {
    if (row.embedding_vec) {
      return Array.from(unpackFloat32(row.embedding_vec));
    }
    // Legacy TEXT row: parse, normalize, backfill the BLOB, return.
    const parsed = l2Normalize(JSON.parse(row.embedding) as number[]);
    if (row.node_id && row.model) {
      this.db.prepare(
        'UPDATE node_embeddings SET embedding_vec = ? WHERE node_id = ? AND model = ?',
      ).run(packFloat32(parsed), row.node_id, row.model);
    }
    return parsed;
  }

  /**
   * Decode a candidate row's vector as a Float32Array view. BLOB rows are
   * zero-copy; legacy TEXT rows are parsed, normalized, and queued for a
   * one-time BLOB backfill (see {@link flushLazyMigration}). Returns null for
   * an unusable row (empty legacy marker with no BLOB).
   */
  private decodeVector(
    row: VectorRow & { node_id: string },
    migrateBack: Array<{ nodeId: string; blob: Buffer }>,
  ): Float32Array | null {
    if (row.embedding_vec) {
      return unpackFloat32(row.embedding_vec);
    }
    if (!row.embedding || row.embedding === '[]') return null;
    const normalized = l2Normalize(JSON.parse(row.embedding) as number[]);
    const blob = packFloat32(normalized);
    migrateBack.push({ nodeId: row.node_id, blob });
    return new Float32Array(normalized);
  }

  /** Persist lazily-migrated BLOBs for rows read from the legacy TEXT column. */
  private flushLazyMigration(model: string, rows: Array<{ nodeId: string; blob: Buffer }>): void {
    if (rows.length === 0) return;
    const stmt = this.db.prepare(
      'UPDATE node_embeddings SET embedding_vec = ? WHERE node_id = ? AND model = ?',
    );
    const tx = this.db.transaction((batch: Array<{ nodeId: string; blob: Buffer }>) => {
      for (const { nodeId, blob } of batch) stmt.run(blob, nodeId, model);
    });
    tx(rows);
  }
}

/** Pack a vector into a little-endian Float32 buffer for BLOB storage. */
function packFloat32(vec: number[]): Buffer {
  const arr = Float32Array.from(vec);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** View a stored BLOB as a Float32Array without copying the underlying bytes. */
function unpackFloat32(blob: Buffer): Float32Array {
  // A Buffer may be a view into a larger pool; slice to this row's bytes and
  // reinterpret as Float32. `byteLength / 4` floats.
  return new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4));
}

function rowToNodeEmbedding(row: NodeEmbeddingRow, embedding: number[]): NodeEmbeddingRecord {
  return {
    nodeId: row.node_id,
    model: row.model,
    dimensions: row.dimensions,
    embedding,
    text: row.text ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Minimal projection of the vector-bearing columns for decode helpers. */
interface VectorRow {
  embedding: string;
  embedding_vec: Buffer | null;
}

interface NodeEmbeddingRow {
  node_id: string;
  model: string;
  dimensions: number;
  embedding: string;
  embedding_vec: Buffer | null;
  text: string | null;
  created_at: string;
  updated_at: string;
}
