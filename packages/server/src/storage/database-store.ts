/**
 * Mindstrate - SQLite Database Store
 *
 * Owns the shared SQLite handle used by graph, session, feedback and
 * evaluation stores.
 */

import type Database from 'better-sqlite3';
import { openSqliteDatabase } from './sqlite-database.js';

export class DatabaseStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
  }

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
