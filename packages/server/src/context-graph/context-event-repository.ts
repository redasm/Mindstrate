import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ContextEvent } from '@mindstrate/protocol/models';
import { ContextEventType } from '@mindstrate/protocol/models';

export interface CreateContextEventInput {
  id?: string;
  type: ContextEventType;
  project?: string;
  sessionId?: string;
  actor?: string;
  content: string;
  metadata?: Record<string, unknown>;
  observedAt?: string;
}

export interface ListContextEventsOptions {
  project?: string;
  type?: ContextEventType;
  limit?: number;
}

export class ContextEventRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateContextEventInput): ContextEvent {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const observedAt = input.observedAt ?? now;

    this.db.prepare(`
      INSERT INTO context_events (
        id, type, project, session_id, actor, content, metadata, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.project ?? null,
      input.sessionId ?? null,
      input.actor ?? null,
      input.content,
      input.metadata ? JSON.stringify(input.metadata) : null,
      observedAt,
      now,
    );

    return this.getById(id)!;
  }

  getById(id: string): ContextEvent | null {
    const row = this.db.prepare('SELECT * FROM context_events WHERE id = ?').get(id) as EventRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  list(options: ListContextEventsOptions = {}): ContextEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_events ${where} ORDER BY observed_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }
}

function rowToEvent(row: EventRow): ContextEvent {
  return {
    id: row.id,
    type: row.type,
    project: row.project ?? undefined,
    sessionId: row.session_id ?? undefined,
    actor: row.actor ?? undefined,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    observedAt: row.observed_at,
    createdAt: row.created_at,
  };
}

interface EventRow {
  id: string;
  type: ContextEventType;
  project: string | null;
  session_id: string | null;
  actor: string | null;
  content: string;
  metadata: string | null;
  observed_at: string;
  created_at: string;
}
