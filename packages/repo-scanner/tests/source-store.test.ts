import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SourceStore } from '../src/source-store.js';

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-scanner-'));
  return path.join(dir, 'scanner.db');
}

describe('SourceStore', () => {
  const toClean: string[] = [];

  afterEach(() => {
    for (const file of toClean.splice(0)) {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });

  it('creates and lists git-local sources', () => {
    const dbPath = tmpDb();
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
    const dbPath = tmpDb();
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
    const dbPath = tmpDb();
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
});
