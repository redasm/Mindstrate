import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { MetabolismRun } from '@mindstrate/protocol/models';

export interface CreateMetabolismRunInput {
  id?: string;
  project?: string;
  trigger: string;
  status: string;
  startedAt?: string;
  stageStats?: Record<string, unknown>;
  notes?: string[];
}

export interface UpdateMetabolismRunInput {
  status?: string;
  endedAt?: string;
  stageStats?: Record<string, unknown>;
  notes?: string[];
}

export interface ListMetabolismRunsOptions {
  project?: string;
  limit?: number;
}

export class MetabolismRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateMetabolismRunInput): MetabolismRun {
    const id = input.id ?? uuidv4();
    const startedAt = input.startedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO metabolism_runs (
        id, project, trigger_type, status, started_at, ended_at, stage_stats, notes
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      input.project ?? null,
      input.trigger,
      input.status,
      startedAt,
      JSON.stringify(input.stageStats ?? {}),
      JSON.stringify(input.notes ?? []),
    );

    return this.getById(id)!;
  }

  update(id: string, input: UpdateMetabolismRunInput): MetabolismRun | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (input.endedAt !== undefined) {
      sets.push('ended_at = ?');
      params.push(input.endedAt);
    }
    if (input.stageStats !== undefined) {
      sets.push('stage_stats = ?');
      params.push(JSON.stringify(input.stageStats));
    }
    if (input.notes !== undefined) {
      sets.push('notes = ?');
      params.push(JSON.stringify(input.notes));
    }

    if (sets.length === 0) return existing;

    params.push(id);
    this.db.prepare(`UPDATE metabolism_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  getById(id: string): MetabolismRun | null {
    const row = this.db.prepare('SELECT * FROM metabolism_runs WHERE id = ?').get(id) as MetabolismRow | undefined;
    return row ? rowToMetabolismRun(row) : null;
  }

  list(options: ListMetabolismRunsOptions = {}): MetabolismRun[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM metabolism_runs ${where} ORDER BY started_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as MetabolismRow[];
    return rows.map(rowToMetabolismRun);
  }
}

function rowToMetabolismRun(row: MetabolismRow): MetabolismRun {
  return {
    id: row.id,
    project: row.project ?? undefined,
    trigger: row.trigger_type as MetabolismRun['trigger'],
    status: row.status as MetabolismRun['status'],
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    stageStats: JSON.parse(row.stage_stats),
    notes: JSON.parse(row.notes),
  };
}

interface MetabolismRow {
  id: string;
  project: string | null;
  trigger_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  stage_stats: string;
  notes: string;
}
