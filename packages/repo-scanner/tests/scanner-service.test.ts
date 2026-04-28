import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Mindstrate } from '@mindstrate/server';
import { RepoScannerService } from '../src/scanner-service.js';
import { createTempDir, removeTempDir } from './helpers.js';

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
  let scannerDir: string;
  let memory: Mindstrate;
  let service: RepoScannerService;

  beforeEach(async () => {
    repoDir = createTempDir('repo-scanner-repo-');
    memoryDir = createTempDir('repo-scanner-memory-');
    scannerDir = createTempDir('repo-scanner-db-');
    initRepo(repoDir);
    commitFile(repoDir, 'app.ts', [
      'export function fixUser() {',
      '  const user = getUser();',
      '  if (!user) return null;',
      '  return user.name;',
      '}',
    ].join('\n'), 'fix: handle missing user');

    memory = new Mindstrate({ dataDir: memoryDir, openaiApiKey: '' });
    await memory.init();
    service = new RepoScannerService({
      scannerDbPath: path.join(scannerDir, 'scanner.db'),
      memory,
    });
    await service.init();
  });

  afterEach(async () => {
    await service.close();
    memory.close();
    removeTempDir(repoDir);
    removeTempDir(memoryDir);
    removeTempDir(scannerDir);
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
    expect(service.store.getSource(source.id)?.lastCursor).toBeTruthy();
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
    const entries = memory.readGraphKnowledge({ project: 'proj', limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0].project).toBe('proj');
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
    expect(service.store.listFailedItems(source.id)).toHaveLength(1);

    shouldFail = false;
    const retried = await service.retryFailedItems(source.id);
    expect(retried.itemsImported).toBe(1);
    expect(service.store.listFailedItems(source.id)).toHaveLength(0);
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
});
