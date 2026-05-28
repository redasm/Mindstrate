import type Database from 'better-sqlite3';

interface ColumnInfo {
  name: string;
  notnull: number;
}

const needsMigration = (db: Database.Database): boolean => {
  const tableRow = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scan_sources'`)
    .get();
  if (!tableRow) return false;
  const columns = db.prepare(`PRAGMA table_info(scan_sources)`).all() as ColumnInfo[];
  const repoPath = columns.find((c) => c.name === 'repo_path');
  const hasDepotPath = columns.some((c) => c.name === 'depot_path');
  if (!repoPath) return false;
  return repoPath.notnull === 1 || !hasDepotPath;
};

const migrateScanSources = (db: Database.Database): void => {
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE scan_sources_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        project TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        repo_path TEXT,
        depot_path TEXT,
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

      INSERT INTO scan_sources_new (
        id, kind, name, project, enabled, repo_path, depot_path, branch,
        interval_sec, init_mode, backfill_count, last_cursor,
        last_run_at, last_success_at, last_error, created_at, updated_at
      )
      SELECT
        id, kind, name, project, enabled, repo_path, NULL, branch,
        interval_sec, init_mode, backfill_count, last_cursor,
        last_run_at, last_success_at, last_error, created_at, updated_at
      FROM scan_sources;

      DROP TABLE scan_sources;
      ALTER TABLE scan_sources_new RENAME TO scan_sources;
    `);
  });
  tx();
};

export const initializeSourceStoreSchema = (db: Database.Database): void => {
  if (needsMigration(db)) {
    migrateScanSources(db);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS scan_sources (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      project TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      repo_path TEXT,
      depot_path TEXT,
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
