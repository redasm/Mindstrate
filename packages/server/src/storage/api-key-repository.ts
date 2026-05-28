import type Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ApiKey, ApiKeyRole, ApiKeyScope, CreateApiKeyInput } from '@mindstrate/protocol';
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
  role: string;
  last_used_at: string | null;
}

const rowToApiKey = (row: ApiKeyRow): ApiKey => ({
  id: row.id,
  name: row.name,
  key: row.key,
  scopes: JSON.parse(row.scopes) as ApiKeyScope[],
  projects: JSON.parse(row.projects) as string[],
  role: (row.role === 'admin' ? 'admin' : 'member') as ApiKeyRole,
  createdAt: row.created_at,
  createdBy: row.created_by ?? undefined,
  revokedAt: row.revoked_at ?? undefined,
  lastUsedAt: row.last_used_at ?? undefined,
});

export class ApiKeyRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initializeApiKeySchema(this.db);
  }

  create(input: CreateApiKeyInput): ApiKey {
    const id = randomUUID();
    const key = input.key ?? randomBytes(32).toString('hex');
    const createdAt = new Date().toISOString();
    const role: ApiKeyRole = input.role ?? 'member';

    this.db.prepare(`
      INSERT INTO api_keys (id, name, key, scopes, projects, created_at, created_by, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      key,
      JSON.stringify(input.scopes),
      JSON.stringify(input.projects),
      createdAt,
      input.createdBy ?? null,
      role,
    );

    return {
      id,
      name: input.name,
      key,
      scopes: input.scopes,
      projects: input.projects,
      role,
      createdAt,
      createdBy: input.createdBy,
    };
  }

  findActiveByKey(key: string): ApiKey | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE key = ? AND revoked_at IS NULL LIMIT 1',
    ).get(key) as ApiKeyRow | undefined;
    if (!row) return null;
    this.touchLastUsed(row.id);
    return rowToApiKey(row);
  }

  findByNameAndKey(name: string, key: string): ApiKey | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE name = ? AND key = ? AND revoked_at IS NULL LIMIT 1',
    ).get(name, key) as ApiKeyRow | undefined;
    if (!row) return null;
    this.touchLastUsed(row.id);
    return rowToApiKey(row);
  }

  findActiveByName(name: string): ApiKey | null {
    const row = this.db.prepare(
      'SELECT * FROM api_keys WHERE name = ? AND revoked_at IS NULL LIMIT 1',
    ).get(name) as ApiKeyRow | undefined;
    return row ? rowToApiKey(row) : null;
  }

  listActive(): ApiKey[] {
    const rows = this.db.prepare(
      'SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC',
    ).all() as ApiKeyRow[];
    return rows.map(rowToApiKey);
  }

  listAll(): ApiKey[] {
    const rows = this.db.prepare(
      'SELECT * FROM api_keys ORDER BY created_at DESC',
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

  setEnabled(id: string, enabled: boolean): boolean {
    const value = enabled ? null : new Date().toISOString();
    const result = this.db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(value, id);
    return result.changes > 0;
  }

  setRole(id: string, role: ApiKeyRole): boolean {
    const result = this.db.prepare('UPDATE api_keys SET role = ? WHERE id = ?').run(role, id);
    return result.changes > 0;
  }

  setProjects(id: string, projects: string[]): boolean {
    const result = this.db.prepare(
      'UPDATE api_keys SET projects = ? WHERE id = ?',
    ).run(JSON.stringify(projects), id);
    return result.changes > 0;
  }

  regenerateKey(id: string): { newKey: string } | null {
    const newKey = randomBytes(32).toString('hex');
    const result = this.db.prepare('UPDATE api_keys SET key = ? WHERE id = ?').run(newKey, id);
    if (result.changes === 0) return null;
    return { newKey };
  }

  deleteHard(id: string): boolean {
    const result = this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
    return result.changes > 0;
  }

  countAdmins(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS c FROM api_keys WHERE role = 'admin' AND revoked_at IS NULL`,
    ).get() as { c: number };
    return row.c;
  }

  private touchLastUsed(id: string): void {
    this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
