import type Database from 'better-sqlite3';

export const initializeSessionSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      decisions TEXT,
      open_tasks TEXT,
      problems_solved TEXT,
      files_modified TEXT,
      tech_context TEXT,
      observations TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  `);
};
