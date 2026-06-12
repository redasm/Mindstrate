import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { ScanSourceRepository } from '../src/storage/scan-source-repository.js';
import { DatabaseStore } from '../src/storage/database-store.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('ScanSourceRepository', () => {
  let tempDir: string;
  let databaseStore: DatabaseStore;
  let repo: ScanSourceRepository;

  beforeEach(() => {
    tempDir = createTempDir();
    databaseStore = new DatabaseStore(path.join(tempDir, 'test.db'));
    repo = new ScanSourceRepository(databaseStore.getDb());
  });

  afterEach(() => {
    databaseStore.close();
    removeTempDir(tempDir);
  });

  it('creates and lists git-local sources with optional remote/token', () => {
    const source = repo.createGitLocalSource({
      name: 'app',
      project: 'app',
      repoPath: '/repos/app',
      remoteUrl: 'https://github.com/acme/app.git',
      authToken: 'ghp_secret',
    });

    const listed = repo.listSources();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(source.id);
    expect(listed[0].kind).toBe('git-local');
    expect(listed[0].remoteUrl).toBe('https://github.com/acme/app.git');
    expect(listed[0].authToken).toBe('ghp_secret');
    expect(listed[0].initMode).toBe('from_now');
  });

  it('allows remote git sources to omit repoPath so scanner chooses source-specific clone path', () => {
    const source = repo.createGitLocalSource({
      name: 'remote-app',
      project: 'app',
      remoteUrl: 'https://github.com/acme/app.git',
    });

    expect(repo.getSource(source.id)?.repoPath).toBeUndefined();
  });

  it('creates p4 sources with per-source credentials', () => {
    const source = repo.createP4Source({
      name: 'depot',
      project: 'app',
      repoPath: '/workspaces/app',
      depotPath: '//depot/main/...',
      p4Port: 'ssl:p4.acme.com:1666',
      p4User: 'svc-scanner',
      p4Passwd: 'p4-secret',
    });

    const fetched = repo.getSource(source.id);
    expect(fetched?.kind).toBe('p4');
    expect(fetched?.depotPath).toBe('//depot/main/...');
    expect(fetched?.p4Port).toBe('ssl:p4.acme.com:1666');
    expect(fetched?.p4User).toBe('svc-scanner');
    expect(fetched?.p4Passwd).toBe('p4-secret');
    expect(fetched?.repoPath).toBe('/workspaces/app');
  });

  it('enables and disables sources', () => {
    const source = repo.createGitLocalSource({ name: 'r', project: 'p', repoPath: '/r' });
    repo.setSourceEnabled(source.id, false);
    expect(repo.getSource(source.id)?.enabled).toBe(false);
    repo.setSourceEnabled(source.id, true);
    expect(repo.getSource(source.id)?.enabled).toBe(true);
  });

  it('updates credential fields via updateSource', () => {
    const source = repo.createP4Source({ name: 'd', project: 'd' });
    const updated = repo.updateSource(source.id, {
      p4Port: 'ssl:new.example:1666',
      p4User: 'new-user',
      intervalSec: 600,
    });
    expect(updated?.p4Port).toBe('ssl:new.example:1666');
    expect(updated?.p4User).toBe('new-user');
    expect(updated?.intervalSec).toBe(600);
  });

  it('records and clears failed items', () => {
    const source = repo.createGitLocalSource({ name: 'r', project: 'p', repoPath: '/r' });
    repo.recordFailedItem(source.id, 'abc123', 'boom');
    let failed = repo.listFailedItems(source.id);
    expect(failed).toHaveLength(1);
    repo.deleteFailedItem(failed[0].id);
    expect(repo.listFailedItems(source.id)).toHaveLength(0);
  });

  it('tracks runs and finishRun updates state', () => {
    const source = repo.createGitLocalSource({ name: 'r', project: 'p', repoPath: '/r' });
    const run = repo.createRun(source.id);
    expect(repo.hasRunningRun(source.id)).toBe(true);
    repo.finishRun(run.id, 'completed', {
      itemsSeen: 3,
      itemsImported: 2,
      itemsSkipped: 1,
      itemsFailed: 0,
    });
    const runs = repo.listRuns(source.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].itemsImported).toBe(2);
  });

  it('updates running scan progress before a run finishes', () => {
    const source = repo.createGitLocalSource({ name: 'r', project: 'p', repoPath: '/r' });
    const run = repo.createRun(source.id);

    repo.updateRunProgress(run.id, {
      itemsSeen: 5,
      itemsImported: 2,
      itemsSkipped: 1,
      itemsFailed: 1,
    });

    const [updated] = repo.listRuns(source.id);
    expect(updated.status).toBe('running');
    expect(updated.itemsSeen).toBe(5);
    expect(updated.itemsImported).toBe(2);
    expect(updated.itemsSkipped).toBe(1);
    expect(updated.itemsFailed).toBe(1);
  });

  it('listDueSources respects intervalSec', () => {
    const source = repo.createGitLocalSource({
      name: 'r',
      project: 'p',
      repoPath: '/r',
      intervalSec: 60,
    });
    expect(repo.listDueSources()).toContainEqual(expect.objectContaining({ id: source.id }));
    repo.markRunStart(source.id);
    const justAfter = new Date(Date.now() + 1000);
    expect(repo.listDueSources(justAfter)).toHaveLength(0);
    const later = new Date(Date.now() + 120_000);
    expect(repo.listDueSources(later)).toContainEqual(expect.objectContaining({ id: source.id }));
  });

  it('deleteSource cascades runs and failed items', () => {
    const source = repo.createGitLocalSource({ name: 'r', project: 'p', repoPath: '/r' });
    repo.createRun(source.id);
    repo.recordFailedItem(source.id, 'abc', 'err');
    expect(repo.deleteSource(source.id)).toBe(true);
    expect(repo.getSource(source.id)).toBeNull();
    expect(repo.listRuns(source.id)).toHaveLength(0);
    expect(repo.listFailedItems(source.id)).toHaveLength(0);
  });
});
