import type Database from 'better-sqlite3';

export const initializeApiKeySchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key TEXT NOT NULL UNIQUE,
      scopes TEXT NOT NULL,
      projects TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      revoked_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
    CREATE INDEX IF NOT EXISTS idx_api_keys_revoked ON api_keys(revoked_at);
  `);

  // Lightweight additive migrations. SQLite raises an error if the column
  // already exists; swallowing keeps init idempotent.
  for (const ddl of [
    `ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`,
    `ALTER TABLE api_keys ADD COLUMN last_used_at TEXT`,
  ]) {
    try { db.exec(ddl); } catch { /* column already exists */ }
  }
};
