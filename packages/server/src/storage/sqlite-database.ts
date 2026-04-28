import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const openSqliteDatabase = (dbPath: string): Database.Database => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};
