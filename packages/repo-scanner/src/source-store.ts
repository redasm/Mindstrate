import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { FailedScanItem, GitLocalSourceInput, ScanRun, ScanSource, ScanRunStatus } from './types.js';

export class SourceStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
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
  }

  createGitLocalSource(input: GitLocalSourceInput): ScanSource {
    const now = new Date().toISOString();
    const source: ScanSource = {
      id: randomUUID(),
      kind: 'git-local',
      name: input.name,
      project: input.project,
      enabled: input.enabled ?? true,
      repoPath: input.repoPath,
      branch: input.branch,
      intervalSec: input.intervalSec ?? 300,
      initMode: input.initMode ?? 'from_now',
      backfillCount: input.backfillCount ?? 10,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO scan_sources (
        id, kind, name, project, enabled, repo_path, branch, interval_sec,
        init_mode, backfill_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      source.id,
      source.kind,
      source.name,
      source.project,
      source.enabled ? 1 : 0,
      source.repoPath,
      source.branch ?? null,
      source.intervalSec,
      source.initMode,
      source.backfillCount,
      source.createdAt,
      source.updatedAt,
    );

    return source;
  }

  listSources(): ScanSource[] {
    return this.db.prepare('SELECT * FROM scan_sources ORDER BY created_at ASC').all().map((row: any) => this.rowToSource(row));
  }

  getSource(id: string): ScanSource | null {
    const row = this.db.prepare('SELECT * FROM scan_sources WHERE id = ?').get(id) as any;
    return row ? this.rowToSource(row) : null;
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    this.db.prepare(
      'UPDATE scan_sources SET enabled = ?, updated_at = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  listDueSources(now: Date = new Date()): ScanSource[] {
    return this.listSources().filter((source) => {
      if (!source.enabled) return false;
      if (!source.lastRunAt) return true;
      const lastRun = new Date(source.lastRunAt).getTime();
      return now.getTime() - lastRun >= source.intervalSec * 1000;
    });
  }

  updateCursor(id: string, cursor: string): void {
    this.db.prepare(`
      UPDATE scan_sources
      SET last_cursor = ?, last_success_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(cursor, new Date().toISOString(), new Date().toISOString(), id);
  }

  markRunStart(id: string): void {
    this.db.prepare('UPDATE scan_sources SET last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), id);
  }

  markError(id: string, error: string): void {
    this.db.prepare('UPDATE scan_sources SET last_error = ?, updated_at = ? WHERE id = ?')
      .run(error, new Date().toISOString(), id);
  }

  hasRunningRun(sourceId: string): boolean {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM scan_runs WHERE source_id = ? AND status = ?',
    ).get(sourceId, 'running') as { count: number };
    return row.count > 0;
  }

  createRun(sourceId: string): ScanRun {
    const run: ScanRun = {
      id: randomUUID(),
      sourceId,
      status: 'running',
      startedAt: new Date().toISOString(),
      itemsSeen: 0,
      itemsImported: 0,
      itemsSkipped: 0,
      itemsFailed: 0,
    };
    this.db.prepare(`
      INSERT INTO scan_runs (
        id, source_id, status, started_at, items_seen, items_imported, items_skipped, items_failed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.sourceId,
      run.status,
      run.startedAt,
      run.itemsSeen,
      run.itemsImported,
      run.itemsSkipped,
      run.itemsFailed,
    );
    return run;
  }

  finishRun(
    id: string,
    status: ScanRunStatus,
    stats: { itemsSeen: number; itemsImported: number; itemsSkipped: number; itemsFailed: number; error?: string },
  ): void {
    this.db.prepare(`
      UPDATE scan_runs
      SET status = ?, finished_at = ?, items_seen = ?, items_imported = ?, items_skipped = ?, items_failed = ?, error = ?
      WHERE id = ?
    `).run(
      status,
      new Date().toISOString(),
      stats.itemsSeen,
      stats.itemsImported,
      stats.itemsSkipped,
      stats.itemsFailed,
      stats.error ?? null,
      id,
    );
  }

  listRuns(sourceId: string): ScanRun[] {
    return this.db.prepare(
      'SELECT * FROM scan_runs WHERE source_id = ? ORDER BY started_at DESC',
    ).all(sourceId).map((row: any) => ({
      id: row.id,
      sourceId: row.source_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      itemsSeen: row.items_seen,
      itemsImported: row.items_imported,
      itemsSkipped: row.items_skipped,
      itemsFailed: row.items_failed,
      error: row.error ?? undefined,
    }));
  }

  recordFailedItem(sourceId: string, externalId: string, error: string): void {
    const existing = this.db.prepare(
      'SELECT * FROM failed_scan_items WHERE source_id = ? AND external_id = ?',
    ).get(sourceId, externalId) as any;
    const now = new Date().toISOString();
    if (existing) {
      this.db.prepare(`
        UPDATE failed_scan_items
        SET error = ?, last_tried_at = ?, retry_count = retry_count + 1
        WHERE id = ?
      `).run(error, now, existing.id);
      return;
    }

    this.db.prepare(`
      INSERT INTO failed_scan_items (
        id, source_id, external_id, error, first_seen_at, last_tried_at, retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(randomUUID(), sourceId, externalId, error, now, now);
  }

  listFailedItems(sourceId: string): FailedScanItem[] {
    return this.db.prepare(
      'SELECT * FROM failed_scan_items WHERE source_id = ? ORDER BY first_seen_at ASC',
    ).all(sourceId).map((row: any) => ({
      id: row.id,
      sourceId: row.source_id,
      externalId: row.external_id,
      error: row.error,
      firstSeenAt: row.first_seen_at,
      lastTriedAt: row.last_tried_at,
      retryCount: row.retry_count,
    }));
  }

  deleteFailedItem(id: string): void {
    this.db.prepare('DELETE FROM failed_scan_items WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }

  private rowToSource(row: any): ScanSource {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      project: row.project,
      enabled: row.enabled === 1,
      repoPath: row.repo_path,
      branch: row.branch ?? undefined,
      intervalSec: row.interval_sec,
      initMode: row.init_mode,
      backfillCount: row.backfill_count,
      lastCursor: row.last_cursor ?? undefined,
      lastRunAt: row.last_run_at ?? undefined,
      lastSuccessAt: row.last_success_at ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
