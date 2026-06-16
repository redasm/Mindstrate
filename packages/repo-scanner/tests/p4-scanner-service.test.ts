import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { Mindstrate } from '@mindstrate/server';
import { createTempDir, removeTempDir } from '../../../tests/support/index.js';

const p4Mocks = vi.hoisted(() => ({
  findP4WorkspaceRoot: vi.fn(),
  getChangelistInfo: vi.fn(),
  getRecentChangelists: vi.fn(),
  listChangelistsSince: vi.fn(),
}));

vi.mock('../src/p4-source.js', () => p4Mocks);

function initRepo(repoPath: string): void {
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "scanner@example.com"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Repo Scanner"', { cwd: repoPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoPath, 'app.ts'), 'export const app = true;\n', 'utf8');
  execSync('git add app.ts', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: 'pipe' });
}

describe('RepoScannerService P4 first-run initialization', () => {
  let repoDir: string;
  let memoryDir: string;
  let memory: Mindstrate;
  let service: import('../src/scanner-service.js').RepoScannerService;

  beforeEach(async () => {
    repoDir = createTempDir('repo-scanner-p4-workspace-');
    memoryDir = createTempDir('repo-scanner-p4-memory-');
    initRepo(repoDir);
    memory = new Mindstrate({ dataDir: memoryDir });
    await memory.init();
    const { RepoScannerService } = await import('../src/scanner-service.js');
    service = new RepoScannerService({ memory });
    await service.init();
    p4Mocks.findP4WorkspaceRoot.mockReset();
    p4Mocks.getChangelistInfo.mockReset();
    p4Mocks.getRecentChangelists.mockReset().mockReturnValue(['42']);
    p4Mocks.listChangelistsSince.mockReset().mockReturnValue([]);
  });

  afterEach(async () => {
    await service.close();
    memory.close();
    removeTempDir(repoDir);
    removeTempDir(memoryDir);
  });

  it('initializes project context from an explicit workspace path before setting from_now cursor', async () => {
    const source = service.addP4Source({
      name: 'p4',
      project: 'proj',
      repoPath: repoDir,
      depotPath: '//depot/main/...',
      initMode: 'from_now',
    });

    const result = await service.runSource(source.id);

    expect(result.mode).toBe('initialized');
    expect(result.itemsImported).toBe(0);
    expect(service.scanner.getSource(source.id)?.lastCursor).toBe('42');
    expect(memory.context.listContextNodes({ project: 'proj', limit: 50 }).length).toBeGreaterThan(0);
    // System pages are internalized so the MCP before-edit/impact tools have
    // project-specific guidance in team mode, matching local `mindstrate init`.
    const systemPageNodes = memory.context
      .listContextNodes({ project: 'proj', limit: 500 })
      .filter((node) => node.metadata?.['systemPage'] === true);
    expect(systemPageNodes.length).toBeGreaterThan(0);
    expect(p4Mocks.findP4WorkspaceRoot).not.toHaveBeenCalled();
  });

  it('falls back to p4 where when no workspace path is stored', async () => {
    p4Mocks.findP4WorkspaceRoot.mockReturnValue(repoDir);
    const source = service.addP4Source({
      name: 'p4',
      project: 'proj',
      depotPath: '//depot/main/...',
      p4Port: 'ssl:p4.example:1666',
      p4User: 'svc',
      p4Passwd: 'secret',
      initMode: 'from_now',
    });

    await service.runSource(source.id);

    expect(p4Mocks.findP4WorkspaceRoot).toHaveBeenCalledWith('//depot/main/...', {
      p4Port: 'ssl:p4.example:1666',
      p4User: 'svc',
      p4Passwd: 'secret',
    });
    expect(memory.context.listContextNodes({ project: 'proj', limit: 50 }).length).toBeGreaterThan(0);
  });

  it('fails first run when no local workspace can be resolved for initialization', async () => {
    p4Mocks.findP4WorkspaceRoot.mockReturnValue(null);
    const source = service.addP4Source({
      name: 'p4',
      project: 'proj',
      depotPath: '//depot/main/...',
      initMode: 'from_now',
    });

    await expect(service.runSource(source.id)).rejects.toThrow('needs a local workspace path');
    expect(service.scanner.getSource(source.id)?.lastCursor).toBeUndefined();
  });
});
