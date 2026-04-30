import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ContextEdge } from '@mindstrate/protocol/models';
import { ContextRelationType } from '@mindstrate/protocol/models';

export interface CreateContextEdgeInput {
  id?: string;
  sourceId: string;
  targetId: string;
  relationType: ContextRelationType;
  strength?: number;
  evidence?: Record<string, unknown>;
}

export interface UpdateContextEdgeInput {
  relationType?: ContextRelationType;
  strength?: number;
  evidence?: Record<string, unknown>;
}

export interface ListContextEdgesOptions {
  sourceId?: string;
  targetId?: string;
  relationType?: ContextRelationType;
  limit?: number;
}

export class ContextEdgeRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateContextEdgeInput): ContextEdge {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();

    this.db.prepare(`
      INSERT INTO context_edges (
        id, source_id, target_id, relation_type, strength, evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.targetId,
      input.relationType,
      input.strength ?? 1,
      input.evidence ? JSON.stringify(input.evidence) : null,
      now,
      now,
    );

    return this.getById(id)!;
  }

  getById(id: string): ContextEdge | null {
    const row = this.db.prepare('SELECT * FROM context_edges WHERE id = ?').get(id) as EdgeRow | undefined;
    return row ? rowToEdge(row) : null;
  }

  update(id: string, input: UpdateContextEdgeInput): ContextEdge | null {
    const current = this.getById(id);
    if (!current) return null;
    const updatedAt = new Date().toISOString();

    this.db.prepare(`
      UPDATE context_edges
      SET relation_type = ?, strength = ?, evidence = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.relationType ?? current.relationType,
      input.strength ?? current.strength,
      input.evidence ? JSON.stringify(input.evidence) : (current.evidence ? JSON.stringify(current.evidence) : null),
      updatedAt,
      id,
    );

    return this.getById(id);
  }

  listOutgoing(sourceId: string, relationType?: ContextRelationType): ContextEdge[] {
    const rows = relationType
      ? this.db.prepare(
        'SELECT * FROM context_edges WHERE source_id = ? AND relation_type = ? ORDER BY updated_at DESC',
      ).all(sourceId, relationType) as EdgeRow[]
      : this.db.prepare(
        'SELECT * FROM context_edges WHERE source_id = ? ORDER BY updated_at DESC',
      ).all(sourceId) as EdgeRow[];

    return rows.map(rowToEdge);
  }

  listIncoming(targetId: string, relationType?: ContextRelationType): ContextEdge[] {
    const rows = relationType
      ? this.db.prepare(
        'SELECT * FROM context_edges WHERE target_id = ? AND relation_type = ? ORDER BY updated_at DESC',
      ).all(targetId, relationType) as EdgeRow[]
      : this.db.prepare(
        'SELECT * FROM context_edges WHERE target_id = ? ORDER BY updated_at DESC',
      ).all(targetId) as EdgeRow[];

    return rows.map(rowToEdge);
  }

  list(options: ListContextEdgesOptions = {}): ContextEdge[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.sourceId) {
      conditions.push('source_id = ?');
      params.push(options.sourceId);
    }
    if (options.targetId) {
      conditions.push('target_id = ?');
      params.push(options.targetId);
    }
    if (options.relationType) {
      conditions.push('relation_type = ?');
      params.push(options.relationType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_edges ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(options.limit ?? 500);

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map(rowToEdge);
  }
}

function rowToEdge(row: EdgeRow): ContextEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationType: row.relation_type,
    strength: row.strength,
    evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: ContextRelationType;
  strength: number;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}
