import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  AppendScanLogInput,
  FailedScanItem,
  GitLocalSourceInput,
  P4SourceInput,
  ScanLog,
  ScanLogLevel,
  ScanRun,
  ScanRunStatus,
  ScanSource,
  ScanSourceKind,
  ScanInitMode,
  UpdateScanSourceInput,
} from '@mindstrate/protocol';
import { initializeScanSourceSchema } from './scan-source-schema.js';

interface ScanSourceRow {
  id: string;
  kind: string;
  name: string;
  project: string;
  enabled: number;
  repo_path: string | null;
  depot_path: string | null;
  branch: string | null;
  remote_url: string | null;
  auth_token: string | null;
  p4_port: string | null;
  p4_user: string | null;
  p4_passwd: string | null;
  interval_sec: number;
  init_mode: string;
  backfill_count: number;
  last_cursor: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ScanRunRow {
  id: string;
  source_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  items_imported: number;
  items_skipped: number;
  items_failed: number;
  error: string | null;
}

interface FailedScanItemRow {
  id: string;
  source_id: string;
  external_id: string;
  error: string;
  first_seen_at: string;
  last_tried_at: string;
  retry_count: number;
}

interface ScanLogRow {
  id: string;
  source_id: string;
  run_id: string | null;
  level: string;
  phase: string | null;
  message: string;
  created_at: string;
}

const rowToSource = (row: ScanSourceRow): ScanSource => ({
  id: row.id,
  kind: row.kind as ScanSourceKind,
  name: row.name,
  project: row.project,
  enabled: row.enabled === 1,
  repoPath: row.repo_path ?? undefined,
  depotPath: row.depot_path ?? undefined,
  branch: row.branch ?? undefined,
  remoteUrl: row.remote_url ?? undefined,
  authToken: row.auth_token ?? undefined,
  p4Port: row.p4_port ?? undefined,
  p4User: row.p4_user ?? undefined,
  p4Passwd: row.p4_passwd ?? undefined,
  intervalSec: row.interval_sec,
  initMode: row.init_mode as ScanInitMode,
  backfillCount: row.backfill_count,
  lastCursor: row.last_cursor ?? undefined,
  lastRunAt: row.last_run_at ?? undefined,
  lastSuccessAt: row.last_success_at ?? undefined,
  lastError: row.last_error ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const rowToRun = (row: ScanRunRow): ScanRun => ({
  id: row.id,
  sourceId: row.source_id,
  status: row.status as ScanRunStatus,
  startedAt: row.started_at,
  finishedAt: row.finished_at ?? undefined,
  itemsSeen: row.items_seen,
  itemsImported: row.items_imported,
  itemsSkipped: row.items_skipped,
  itemsFailed: row.items_failed,
  error: row.error ?? undefined,
});

const rowToFailed = (row: FailedScanItemRow): FailedScanItem => ({
  id: row.id,
  sourceId: row.source_id,
  externalId: row.external_id,
  error: row.error,
  firstSeenAt: row.first_seen_at,
  lastTriedAt: row.last_tried_at,
  retryCount: row.retry_count,
});

const rowToLog = (row: ScanLogRow): ScanLog => ({
  id: row.id,
  sourceId: row.source_id,
  runId: row.run_id ?? undefined,
  level: row.level as ScanLogLevel,
  phase: row.phase ?? undefined,
  message: row.message,
  createdAt: row.created_at,
});

export class ScanSourceRepository {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    initializeScanSourceSchema(this.db);
  }

  createGitLocalSource(input: GitLocalSourceInput): ScanSource {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO scan_sources (
        id, kind, name, project, enabled, repo_path, depot_path, branch,
        remote_url, auth_token, p4_port, p4_user, p4_passwd,
        interval_sec, init_mode, backfill_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      'git-local',
      input.name,
      input.project,
      (input.enabled ?? true) ? 1 : 0,
      input.repoPath ?? null,
      null,
      input.branch ?? null,
      input.remoteUrl ?? null,
      input.authToken ?? null,
      null,
      null,
      null,
      input.intervalSec ?? 300,
      input.initMode ?? 'from_now',
      input.backfillCount ?? 10,
      now,
      now,
    );
    return this.getSource(id)!;
  }

  createP4Source(input: P4SourceInput): ScanSource {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO scan_sources (
        id, kind, name, project, enabled, repo_path, depot_path, branch,
        remote_url, auth_token, p4_port, p4_user, p4_passwd,
        interval_sec, init_mode, backfill_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      'p4',
      input.name,
      input.project,
      (input.enabled ?? true) ? 1 : 0,
      input.repoPath ?? null,
      input.depotPath ?? null,
      null,
      null,
      null,
      input.p4Port ?? null,
      input.p4User ?? null,
      input.p4Passwd ?? null,
      input.intervalSec ?? 300,
      input.initMode ?? 'from_now',
      input.backfillCount ?? 10,
      now,
      now,
    );
    return this.getSource(id)!;
  }

  listSources(): ScanSource[] {
    const rows = this.db.prepare(
      'SELECT * FROM scan_sources ORDER BY created_at ASC',
    ).all() as ScanSourceRow[];
    return rows.map(rowToSource);
  }

  getSource(id: string): ScanSource | null {
    const row = this.db.prepare('SELECT * FROM scan_sources WHERE id = ?').get(id) as ScanSourceRow | undefined;
    return row ? rowToSource(row) : null;
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE scan_sources SET enabled = ?, updated_at = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, now, id);
  }

  updateSource(id: string, patch: UpdateScanSourceInput): ScanSource | null {
    const current = this.getSource(id);
    if (!current) return null;

    const fields: string[] = [];
    const values: (string | number | null)[] = [];
    const setField = (column: string, value: string | number | null | undefined) => {
      if (value === undefined) return;
      fields.push(`${column} = ?`);
      values.push(value);
    };

    setField('name', patch.name);
    setField('project', patch.project);
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    setField('repo_path', patch.repoPath);
    setField('depot_path', patch.depotPath);
    setField('branch', patch.branch);
    setField('remote_url', patch.remoteUrl);
    setField('auth_token', patch.authToken);
    setField('p4_port', patch.p4Port);
    setField('p4_user', patch.p4User);
    setField('p4_passwd', patch.p4Passwd);
    setField('interval_sec', patch.intervalSec);
    setField('init_mode', patch.initMode);
    setField('backfill_count', patch.backfillCount);

    if (fields.length === 0) return current;

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    this.db.prepare(`UPDATE scan_sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getSource(id);
  }

  deleteSource(id: string): boolean {
    const tx = this.db.transaction((sourceId: string) => {
      this.db.prepare('DELETE FROM scan_logs WHERE source_id = ?').run(sourceId);
      this.db.prepare('DELETE FROM failed_scan_items WHERE source_id = ?').run(sourceId);
      this.db.prepare('DELETE FROM scan_runs WHERE source_id = ?').run(sourceId);
      const result = this.db.prepare('DELETE FROM scan_sources WHERE id = ?').run(sourceId);
      return result.changes > 0;
    });
    return tx(id);
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
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE scan_sources
      SET last_cursor = ?, last_success_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(cursor, now, now, id);
  }

  /**
   * Clear a source's cursor so its next scan is treated as a first run again
   * (full project-graph re-index instead of an incremental commit diff). This
   * is how "re-scan from scratch" works without deleting and recreating the
   * source: `executeGitLocalSource` / `executeP4Source` branch on an empty
   * `last_cursor`. Also clears run timestamps/error so the scheduler picks the
   * source up immediately on its next tick.
   */
  resetCursor(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE scan_sources
      SET last_cursor = NULL, last_run_at = NULL, last_success_at = NULL, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, id);
    return result.changes > 0;
  }

  markRunStart(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE scan_sources SET last_run_at = ?, updated_at = ? WHERE id = ?',
    ).run(now, now, id);
  }

  markError(id: string, error: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      'UPDATE scan_sources SET last_error = ?, updated_at = ? WHERE id = ?',
    ).run(error, now, id);
  }

  hasRunningRun(sourceId: string): boolean {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS count FROM scan_runs WHERE source_id = ? AND status = ?',
    ).get(sourceId, 'running') as { count: number };
    return row.count > 0;
  }

  /**
   * Finalize runs left in `running` by a process that died mid-scan.
   * Without this, a crashed/restarted scanner leaves the run row running
   * forever and `hasRunningRun` blocks every future scan of that source.
   * Only safe to call when no scan can be in flight (daemon startup).
   */
  recoverOrphanedRuns(): number {
    const running = this.db
      .prepare("SELECT id, source_id FROM scan_runs WHERE status = 'running'")
      .all() as { id: string; source_id: string }[];
    if (running.length === 0) return 0;

    const now = new Date().toISOString();
    const message = 'orphaned: scanner stopped mid-run';
    const finalize = this.db.prepare(`
      UPDATE scan_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?
    `);
    const logStmt = this.db.prepare(`
      INSERT INTO scan_logs (id, source_id, run_id, level, phase, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const run of running) {
        finalize.run(now, message, run.id);
        logStmt.run(
          randomUUID(),
          run.source_id,
          run.id,
          'error',
          'recover',
          'Previous run was orphaned — the scanner process stopped mid-run '
            + '(crash, restart, or out-of-memory) and the run was marked failed on startup.',
          now,
        );
      }
    });
    tx();
    return running.length;
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

  updateRunProgress(
    id: string,
    stats: { itemsSeen: number; itemsImported: number; itemsSkipped: number; itemsFailed: number },
  ): void {
    this.db.prepare(`
      UPDATE scan_runs
      SET items_seen = ?, items_imported = ?, items_skipped = ?, items_failed = ?
      WHERE id = ? AND status = ?
    `).run(
      stats.itemsSeen,
      stats.itemsImported,
      stats.itemsSkipped,
      stats.itemsFailed,
      id,
      'running',
    );
  }

  listRuns(sourceId: string): ScanRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM scan_runs WHERE source_id = ? ORDER BY started_at DESC',
    ).all(sourceId) as ScanRunRow[];
    return rows.map(rowToRun);
  }

  recordFailedItem(sourceId: string, externalId: string, error: string): void {
    const existing = this.db.prepare(
      'SELECT * FROM failed_scan_items WHERE source_id = ? AND external_id = ?',
    ).get(sourceId, externalId) as FailedScanItemRow | undefined;
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
    const rows = this.db.prepare(
      'SELECT * FROM failed_scan_items WHERE source_id = ? ORDER BY first_seen_at ASC',
    ).all(sourceId) as FailedScanItemRow[];
    return rows.map(rowToFailed);
  }

  deleteFailedItem(id: string): void {
    this.db.prepare('DELETE FROM failed_scan_items WHERE id = ?').run(id);
  }

  appendLog(input: AppendScanLogInput): ScanLog {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO scan_logs (id, source_id, run_id, level, phase, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.runId ?? null,
      input.level,
      input.phase ?? null,
      input.message,
      now,
    );
    return {
      id,
      sourceId: input.sourceId,
      runId: input.runId ?? undefined,
      level: input.level,
      phase: input.phase,
      message: input.message,
      createdAt: now,
    };
  }

  /** Returns the most recent `limit` log lines in chronological (oldest-first) order. */
  listLogs(sourceId: string, limit = 200): ScanLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM scan_logs
      WHERE source_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(sourceId, limit) as ScanLogRow[];
    return rows.map(rowToLog).reverse();
  }

  /** Keep only the newest `keep` log rows for a source; a hard cap so the
   *  table can never grow without bound regardless of scan frequency. */
  pruneLogs(sourceId: string, keep: number): void {
    this.db.prepare(`
      DELETE FROM scan_logs
      WHERE source_id = ?
        AND rowid NOT IN (
          SELECT rowid FROM scan_logs WHERE source_id = ? ORDER BY rowid DESC LIMIT ?
        )
    `).run(sourceId, sourceId, keep);
  }

  /** Delete every log row for a source. Returns the number of rows removed. */
  clearLogs(sourceId: string): number {
    return this.db.prepare('DELETE FROM scan_logs WHERE source_id = ?').run(sourceId).changes;
  }
}
