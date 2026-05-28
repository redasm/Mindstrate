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
};
