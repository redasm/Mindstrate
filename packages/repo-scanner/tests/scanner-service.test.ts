import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { ChangeSource, Mindstrate, type ChangeSet } from '@mindstrate/server';
import { RepoScannerService } from '../src/scanner-service.js';
import type { RepoScannerMindstrateInput, RepoScannerSourceAdapter } from '../src/types.js';
import { createTempDir, removeTempDir } from '../../../tests/support/index.js';

function initRepo(repoPath: string): void {
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "scanner@example.com"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Repo Scanner"', { cwd: repoPath, stdio: 'pipe' });
}

function commitFile(repoPath: string, file: string, content: string, message: string): void {
  fs.writeFileSync(path.join(repoPath, file), content, 'utf8');
  execSync(`git add ${file}`, { cwd: repoPath, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'pipe' });
}

describe('RepoScannerService', () => {
  let repoDir: string;
  let memoryDir: string;
  let memory: Mindstrate;
  let service: RepoScannerService;

  beforeEach(async () => {
    repoDir = createTempDir('repo-scanner-repo-');
    memoryDir = createTempDir('repo-scanner-memory-');
    initRepo(repoDir);
    commitFile(repoDir, 'app.ts', [
      'export function fixUser() {',
      '  const user = getUser();',
      '  if (!user) return null;',
      '  return user.name;',
      '}',
    ].join('\n'), 'fix: handle missing user');

    memory = new Mindstrate({ dataDir: memoryDir });
    await memory.init();
    service = new RepoScannerService({ memory });
    await service.init();
  });

  afterEach(async () => {
    await service.close();
    memory.close();
    removeTempDir(repoDir);
    removeTempDir(memoryDir);
  });

  it('initializes from current head when initMode=from_now', async () => {
    const source = service.addGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: repoDir,
      initMode: 'from_now',
    });

    const result = await service.runSource(source.id);
    expect(result.mode).toBe('initialized');
    expect(result.itemsImported).toBe(0);
    expect(service.scanner.getSource(source.id)?.lastCursor).toBeTruthy();
    expect(memory.context.listContextNodes({ project: 'proj', limit: 50 }).length).toBeGreaterThan(0);
  });

  it('backfills recent commits and writes extracted knowledge', async () => {
    const source = service.addGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: repoDir,
      initMode: 'backfill_recent',
      backfillCount: 5,
    });

    const result = await service.runSource(source.id);
    expect(result.itemsSeen).toBe(1);
    expect(result.itemsImported).toBe(1);
    const entries = memory.context.readGraphKnowledge({ project: 'proj', limit: 10 });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.every((entry) => entry.project === 'proj')).toBe(true);
  });

  it('stamps project-graph staleness markers for ingested upstream commits', async () => {
    const source = service.addGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: repoDir,
      initMode: 'from_now',
    });
    await service.runSource(source.id); // first run: indexes the graph, sets the cursor

    commitFile(repoDir, 'app.ts', [
      'export function fixUser() {',
      '  return getUser()?.name ?? null;',
      '}',
    ].join('\n'), 'refactor: simplify user lookup');

    const incremental = await service.runSource(source.id);
    expect(incremental.itemsSeen).toBe(1);

    const marked = memory.context.listContextNodes({ project: 'proj', limit: 500 })
      .filter((node) => node.metadata?.['externalChanges']);
    expect(marked.length).toBeGreaterThan(0);

    const projectNode = marked.find((node) => node.metadata?.['kind'] === 'project');
    expect(projectNode).toBeDefined();
    const marker = projectNode!.metadata!['externalChanges'] as { pendingChanges: number; lastSource: string; lastExternalRef?: string };
    expect(marker.pendingChanges).toBe(1);
    expect(marker.lastSource).toBe('git');
    expect(marker.lastExternalRef).toBeTruthy();
  });

  it('records failed commits and supports retrying them', async () => {
    const source = service.addGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: repoDir,
      initMode: 'backfill_recent',
      backfillCount: 5,
    });

    let shouldFail = true;
    (service as any).extractor = {
      extractFromCommit: async () => {
        if (shouldFail) throw new Error('extract failed');
        return {
          extracted: true,
          input: {
            type: 'bug_fix',
            title: 'Recovered knowledge',
            solution: 'Recovered after retry',
            context: { language: 'typescript' },
            tags: [],
            author: 'Repo Scanner',
            source: 'git_hook',
            confidence: 0.8,
          },
          reason: 'ok',
        };
      },
    };

    const result = await service.runSource(source.id);
    expect(result.itemsFailed).toBe(1);
    expect(service.scanner.listFailedItems(source.id)).toHaveLength(1);

    shouldFail = false;
    const retried = await service.retryFailedItems(source.id);
    expect(retried.itemsImported).toBe(1);
    expect(service.scanner.listFailedItems(source.id)).toHaveLength(0);
  });

  it('returns source status summary including runs and failed items', async () => {
    const source = service.addGitLocalSource({
      name: 'repo',
      project: 'proj',
      repoPath: repoDir,
      initMode: 'from_now',
    });

    await service.runSource(source.id);
    const status = service.getSourceStatus(source.id);

    expect(status.source.id).toBe(source.id);
    expect(status.recentRuns).toHaveLength(1);
    expect(status.failedItems).toHaveLength(0);
  });

  it('defines a custom source adapter contract that emits standard Mindstrate inputs', async () => {
    const adapter: RepoScannerSourceAdapter<{ id: string; files: string[] }> = {
      id: 'custom-p4',
      kind: 'custom',
      async discover() {
        return {
          cursor: '101',
          items: [{ id: '101', files: ['Source/Client/Client.Build.cs'] }],
        };
      },
      async toMindstrateInput(item) {
        const changeSet: ChangeSet = {
          source: ChangeSource.P4,
          head: item.id,
          files: item.files.map((file) => ({ path: file, status: 'modified' })),
        };
        return { type: 'changeset', project: 'proj', changeSet };
      },
    };

    const discovered = await adapter.discover({ sourceId: 'source-1' });
    const input: RepoScannerMindstrateInput = await adapter.toMindstrateInput(discovered.items[0]);

    expect(discovered.cursor).toBe('101');
    expect(input).toEqual({
      type: 'changeset',
      project: 'proj',
      changeSet: {
        source: ChangeSource.P4,
        head: '101',
        files: [{ path: 'Source/Client/Client.Build.cs', status: 'modified' }],
      },
    });
  });

  it('runs custom source adapters and routes changesets into Mindstrate', async () => {
    const adapter: RepoScannerSourceAdapter<{ id: string; files: string[] }> = {
      id: 'custom-p4',
      kind: 'custom',
      async discover(input) {
        expect(input.cursor).toBeUndefined();
        return {
          cursor: '101',
          items: [{ id: '101', files: ['app.ts'] }],
        };
      },
      async toMindstrateInput(item) {
        return {
          type: 'changeset',
          project: 'proj',
          changeSet: {
            source: ChangeSource.P4,
            head: item.id,
            files: item.files.map((file) => ({ path: file, status: 'modified' })),
          },
        };
      },
    };

    const result = await service.runAdapter(adapter, { sourceId: 'custom-p4' });

    expect(result).toMatchObject({
      sourceId: 'custom-p4',
      mode: 'incremental',
      itemsSeen: 1,
      itemsImported: 1,
      itemsSkipped: 0,
      itemsFailed: 0,
      cursor: '101',
    });
  });
});
