import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const openSqliteDatabase = (dbPath: string): Database.Database => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // Wait up to 5s for a write lock instead of failing immediately. WAL still
  // serializes writers to one at a time, and the deployment runs three
  // processes (team-server, web-ui, repo-scanner) against the same SQLite file
  // on a shared volume. Without a busy timeout, a writer that collides with
  // another (e.g. the scanner's node-embedding backfill overlapping the
  // team-server metabolism tick) gets an instant `SQLITE_BUSY: database is
  // locked` and aborts. A few seconds of retry lets these brief write windows
  // pass instead of dropping work.
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
};
