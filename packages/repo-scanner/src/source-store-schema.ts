import type Database from 'better-sqlite3';

export const initializeSourceStoreSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      project TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      repo_path TEXT NOT NULL,
      branch TEXT,
      interval_sec INTEGER NOT NULL,
      init_mode TEXT NOT NULL,
      backfill_count INTEGER NOT NULL,
      last_cursor TEXT,
      last_run_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      items_seen INTEGER NOT NULL DEFAULT 0,
      items_imported INTEGER NOT NULL DEFAULT 0,
      items_skipped INTEGER NOT NULL DEFAULT 0,
      items_failed INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      FOREIGN KEY (source_id) REFERENCES scan_sources(id)
    );

    CREATE TABLE IF NOT EXISTS failed_scan_items (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      error TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_tried_at TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (source_id) REFERENCES scan_sources(id)
    );
  `);
};
