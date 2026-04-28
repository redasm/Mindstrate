import type Database from 'better-sqlite3';

export const initializeEvaluationSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_cases (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      expected_ids TEXT NOT NULL,
      language TEXT,
      framework TEXT,
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
  `);
};
