import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ConflictRecord, ProjectionRecord } from '@mindstrate/protocol/models';

export interface CreateConflictRecordInput {
  id?: string;
  project?: string;
  nodeIds: string[];
  reason: string;
  detectedAt?: string;
}

export interface ListConflictRecordsOptions {
  project?: string;
  limit?: number;
}

export interface UpsertProjectionRecordInput {
  id?: string;
  nodeId: string;
  target: string;
  targetRef: string;
  version: number;
  projectedAt?: string;
}

export interface ListProjectionRecordsOptions {
  nodeId?: string;
  target?: string;
  limit?: number;
}

export class ConflictRecordRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateConflictRecordInput): ConflictRecord {
    const id = input.id ?? uuidv4();
    const detectedAt = input.detectedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO conflict_records (
        id, project, node_ids, reason, detected_at, resolved_at, resolution
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      id,
      input.project ?? null,
      JSON.stringify(input.nodeIds),
      input.reason,
      detectedAt,
    );

    return this.getById(id)!;
  }

  getById(id: string): ConflictRecord | null {
    const row = this.db.prepare('SELECT * FROM conflict_records WHERE id = ?').get(id) as ConflictRow | undefined;
    return row ? rowToConflict(row) : null;
  }

  resolve(id: string, resolution: string, resolvedAt: string = new Date().toISOString()): ConflictRecord | null {
    const existing = this.getById(id);
    if (!existing) return null;

    this.db.prepare(`
      UPDATE conflict_records
      SET resolved_at = ?, resolution = ?
      WHERE id = ?
    `).run(resolvedAt, resolution, id);

    return this.getById(id);
  }

  list(options: ListConflictRecordsOptions = {}): ConflictRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM conflict_records ${where} ORDER BY detected_at DESC LIMIT ?`;
    params.push(options.limit ?? 200);

    const rows = this.db.prepare(sql).all(...params) as ConflictRow[];
    return rows.map(rowToConflict);
  }
}

export class ProjectionRecordRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: UpsertProjectionRecordInput): ProjectionRecord {
    const id = input.id ?? uuidv4();
    const projectedAt = input.projectedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO projection_records (id, node_id, target, target_ref, version, projected_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        node_id = excluded.node_id,
        target = excluded.target,
        target_ref = excluded.target_ref,
        version = excluded.version,
        projected_at = excluded.projected_at
    `).run(id, input.nodeId, input.target, input.targetRef, input.version, projectedAt);

    return this.getById(id)!;
  }

  getById(id: string): ProjectionRecord | null {
    const row = this.db.prepare('SELECT * FROM projection_records WHERE id = ?').get(id) as ProjectionRow | undefined;
    return row ? rowToProjection(row) : null;
  }

  list(options: ListProjectionRecordsOptions = {}): ProjectionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.nodeId) {
      conditions.push('node_id = ?');
      params.push(options.nodeId);
    }
    if (options.target) {
      conditions.push('target = ?');
      params.push(options.target);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM projection_records ${where} ORDER BY projected_at DESC LIMIT ?`;
    params.push(options.limit ?? 200);

    const rows = this.db.prepare(sql).all(...params) as ProjectionRow[];
    return rows.map(rowToProjection);
  }
}

function rowToConflict(row: ConflictRow): ConflictRecord {
  return {
    id: row.id,
    project: row.project ?? undefined,
    nodeIds: JSON.parse(row.node_ids),
    reason: row.reason,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolution: row.resolution ?? undefined,
  };
}

function rowToProjection(row: ProjectionRow): ProjectionRecord {
  return {
    id: row.id,
    nodeId: row.node_id,
    target: row.target as ProjectionRecord['target'],
    targetRef: row.target_ref,
    version: row.version,
    projectedAt: row.projected_at,
  };
}

interface ConflictRow {
  id: string;
  project: string | null;
  node_ids: string;
  reason: string;
  detected_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

interface ProjectionRow {
  id: string;
  node_id: string;
  target: string;
  target_ref: string;
  version: number;
  projected_at: string;
}
