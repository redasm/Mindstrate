import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ApiKey, ApiKeyScope, CreateApiKeyInput } from '@mindstrate/protocol';
import { initializeApiKeySchema } from './api-key-schema.js';

interface ApiKeyRow {
  id: string;
  name: string;
  key: string;
  scopes: string;
  projects: string;
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
}

const rowToApiKey = (row: ApiKeyRow): ApiKey => ({
  id: row.id,
  name: row.name,
  key: row.key,
  scopes: JSON.parse(row.scopes) as ApiKeyScope[],
  projects: JSON.parse(row.projects) as string[],
  createdAt: row.created_at,
  createdBy: row.created_by ?? undefined,
  revokedAt: row.revoked_at ?? undefined,
});

export class ApiKeyRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initializeApiKeySchema(this.db);
  }

  create(input: CreateApiKeyInput): ApiKey {
    const id = randomUUID();
    const key = randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO api_keys (id, name, key, scopes, projects, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      key,
      JSON.stringify(input.scopes),
      JSON.stringify(input.projects),
      createdAt,
      input.createdBy ?? null,
    );

    return {
      id,
      name: input.name,
      key,
      scopes: input.scopes,
      projects: input.projects,
      createdAt,
      createdBy: input.createdBy,
    };
  }

  findActiveByKey(key: string): ApiKey | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE key = ? AND revoked_at IS NULL LIMIT 1',
    ).get(key) as ApiKeyRow | undefined;
    return row ? rowToApiKey(row) : null;
  }

  listActive(): ApiKey[] {
    const rows = this.db.prepare(
      'SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC',
    ).all() as ApiKeyRow[];
    return rows.map(rowToApiKey);
  }

  getById(id: string): ApiKey | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ? LIMIT 1').get(id) as ApiKeyRow | undefined;
    return row ? rowToApiKey(row) : null;
  }

  revoke(id: string): boolean {
    const result = this.db.prepare(
      'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    ).run(new Date().toISOString(), id);
    return result.changes > 0;
  }
}
