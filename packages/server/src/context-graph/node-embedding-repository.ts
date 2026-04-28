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
