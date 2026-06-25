import Database from 'better-sqlite3';

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

    this.db.prepare(`
      INSERT INTO node_embeddings (
        node_id, model, dimensions, embedding, text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id, model) DO UPDATE SET
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        text = excluded.text,
        updated_at = excluded.updated_at
    `).run(
      input.nodeId,
      input.model,
      input.dimensions,
      JSON.stringify(input.embedding),
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
    return row ? rowToNodeEmbedding(row) : null;
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
   * round-trip. Cosine is computed in JS by the caller (better-sqlite3 has
   * no vector ops); this keeps the scan bounded to the model's rows rather
   * than the whole graph.
   */
  candidatesForSearch(opts: {
    model: string;
    project?: string;
    statuses?: string[];
  }): Array<{ nodeId: string; embedding: number[] }> {
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
    const rows = this.db.prepare(`
      SELECT ne.node_id AS node_id, ne.embedding AS embedding
      FROM node_embeddings ne
      JOIN context_nodes n ON n.id = ne.node_id
      WHERE ${conditions.join(' AND ')}
    `).all(...params) as Array<{ node_id: string; embedding: string }>;
    return rows.map((row) => ({ nodeId: row.node_id, embedding: JSON.parse(row.embedding) }));
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
}

function rowToNodeEmbedding(row: NodeEmbeddingRow): NodeEmbeddingRecord {
  return {
    nodeId: row.node_id,
    model: row.model,
    dimensions: row.dimensions,
    embedding: JSON.parse(row.embedding),
    text: row.text ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface NodeEmbeddingRow {
  node_id: string;
  model: string;
  dimensions: number;
  embedding: string;
  text: string | null;
  created_at: string;
  updated_at: string;
}
