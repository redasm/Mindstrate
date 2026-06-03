import type Database from 'better-sqlite3';

export const initializeEvaluationSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_cases (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      expected_ids TEXT NOT NULL,
      language TEXT,
      framework TEXT,
      kind TEXT NOT NULL DEFAULT 'validation',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      total_cases INTEGER NOT NULL,
      precision REAL NOT NULL,
      recall REAL NOT NULL,
      f1 REAL NOT NULL,
      mrr REAL NOT NULL,
      details TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_eval_runs_timestamp
      ON eval_runs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_eval_cases_kind
      ON eval_cases(kind);
  `);

  // Backfill the kind column on databases created before dataset
  // authoring landed. SQLite has no "ADD COLUMN IF NOT EXISTS", so probe
  // the schema first.
  const columns = db.prepare(`PRAGMA table_info(eval_cases)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'kind')) {
    db.exec(`ALTER TABLE eval_cases ADD COLUMN kind TEXT NOT NULL DEFAULT 'validation'`);
  }
};
