import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { SourceStore } from '../src/source-store.js';
import { createTempDir, removeTempDir } from '../../../tests/support/index.js';

function createDbPath(): string {
  const dir = createTempDir('repo-scanner-');
  return path.join(dir, 'scanner.db');
}

describe('SourceStore', () => {
  const toClean: string[] = [];

  afterEach(() => {
    for (const file of toClean.splice(0)) {
      removeTempDir(path.dirname(file));
    }
  });

  it('creates and lists git-local sources', () => {
    const dbPath = createDbPath();
    toClean.push(dbPath);
    const store = new SourceStore(dbPath);

    const source = store.createGitLocalSource({
      name: 'app',
      project: 'app',
      repoPath: 'C:\\repo',
    });

    const listed = store.listSources();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(source.id);
    expect(listed[0].initMode).toBe('from_now');
    store.close();
  });

  it('stores runs and failed items for later inspection', () => {
    const dbPath = createDbPath();
    toClean.push(dbPath);
    const store = new SourceStore(dbPath);
    const source = store.createGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: 'C:\\repo',
    });

    const run = store.createRun(source.id);
    store.finishRun(run.id, 'failed', {
      itemsSeen: 1,
      itemsImported: 0,
      itemsSkipped: 0,
      itemsFailed: 1,
      error: 'boom',
    });
    store.recordFailedItem(source.id, 'abc123', 'boom');

    expect(store.listRuns(source.id)).toHaveLength(1);
    expect(store.listFailedItems(source.id)).toHaveLength(1);
    store.close();
  });

  it('can enable and disable sources', () => {
    const dbPath = createDbPath();
    toClean.push(dbPath);
    const store = new SourceStore(dbPath);
    const source = store.createGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: 'C:\\repo',
    });

    store.setSourceEnabled(source.id, false);
    expect(store.getSource(source.id)?.enabled).toBe(false);

    store.setSourceEnabled(source.id, true);
    expect(store.getSource(source.id)?.enabled).toBe(true);
    store.close();
  });

  it('creates and lists p4 sources alongside git', () => {
    const dbPath = createDbPath();
    toClean.push(dbPath);
    const store = new SourceStore(dbPath);

    const gitSource = store.createGitLocalSource({
      name: 'g',
      project: 'g',
      repoPath: '/repo',
    });
    const p4Source = store.createP4Source({
      name: 'p',
      project: 'p',
      depotPath: '//depot/main/...',
    });

    const listed = store.listSources();
    expect(listed).toHaveLength(2);
    const fetchedP4 = store.getSource(p4Source.id);
    expect(fetchedP4?.kind).toBe('p4');
    expect(fetchedP4?.depotPath).toBe('//depot/main/...');
    expect(fetchedP4?.repoPath).toBeUndefined();
    const fetchedGit = store.getSource(gitSource.id);
    expect(fetchedGit?.kind).toBe('git-local');
    expect(fetchedGit?.repoPath).toBe('/repo');
    expect(fetchedGit?.depotPath).toBeUndefined();
    store.close();
  });

  it('migrates an old-shape db with NOT NULL repo_path and no depot_path', () => {
    const dbPath = createDbPath();
    toClean.push(dbPath);

    // Hand-build an old-shape DB: repo_path NOT NULL, no depot_path.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE scan_sources (
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
    `);
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO scan_sources (
        id, kind, name, project, enabled, repo_path, branch, interval_sec,
        init_mode, backfill_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('legacy-id', 'git-local', 'legacy', 'legacy-proj', 1, '/legacy/repo', null, 300, 'from_now', 10, now, now);
    db.close();

    // Opening through SourceStore triggers the migration.
    const store = new SourceStore(dbPath);
    const migrated = store.getSource('legacy-id');
    expect(migrated).toBeTruthy();
    expect(migrated?.repoPath).toBe('/legacy/repo');
    expect(migrated?.depotPath).toBeUndefined();

    // Migration should now allow registering a P4 source (NULL repo_path).
    const p4 = store.createP4Source({ name: 'p', project: 'p', depotPath: '//depot/...' });
    expect(store.getSource(p4.id)?.depotPath).toBe('//depot/...');
    store.close();
  });
});
