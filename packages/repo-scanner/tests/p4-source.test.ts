import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execSync }));

describe('P4 source helpers', () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  it('resolves workspace root from p4 -ztag where output', async () => {
    execSync.mockReturnValue([
      '... depotFile //depot/main/...',
      '... clientFile //client/main/...',
      '... path C:\\work\\game\\...',
      '',
      '... depotFile //depot/main/Source/...',
      '... clientFile //client/main/Source/...',
      '... path C:\\work\\game\\Source\\...',
      '',
    ].join('\n'));

    const { findP4WorkspaceRoot } = await import('../src/p4-source.js');

    expect(findP4WorkspaceRoot('//depot/main/...', {
      p4Port: 'ssl:p4.example:1666',
      p4User: 'svc',
      p4Passwd: 'secret',
    })).toBe('C:\\work\\game');
    expect(execSync).toHaveBeenCalledWith('p4 -ztag where //depot/main/...', expect.objectContaining({
      env: expect.objectContaining({
        P4PORT: 'ssl:p4.example:1666',
        P4USER: 'svc',
        P4PASSWD: 'secret',
      }),
    }));
  });

  it('keeps local paths containing spaces intact and skips unmapped entries', async () => {
    execSync.mockReturnValue([
      '... depotFile //depot/main/...',
      '... clientFile //client/main/...',
      '... path C:\\Program Files\\Game Workspace\\main\\...',
      '',
      '... unmap',
      '... depotFile //depot/main/Excluded/...',
      '... clientFile //client/main/Excluded/...',
      '... path C:\\Somewhere\\Else\\...',
      '',
    ].join('\n'));

    const { findP4WorkspaceRoot } = await import('../src/p4-source.js');

    expect(findP4WorkspaceRoot('//depot/main/...')).toBe('C:\\Program Files\\Game Workspace\\main');
  });

  it('returns null when p4 where fails', async () => {
    execSync.mockImplementation(() => {
      throw new Error('p4 failed');
    });

    const { findP4WorkspaceRoot } = await import('../src/p4-source.js');

    expect(findP4WorkspaceRoot('//depot/main/...')).toBeNull();
  });

  it('rejects invalid depot paths before shelling out', async () => {
    const { findP4WorkspaceRoot } = await import('../src/p4-source.js');

    expect(() => findP4WorkspaceRoot('//depot/main/...; rm -rf /')).toThrow('Invalid depot path format');
    expect(execSync).not.toHaveBeenCalled();
  });

  it('normalizes malformed P4PORT values', async () => {
    const { normalizeP4Port } = await import('../src/p4-source.js');

    expect(normalizeP4Port('//p4.example:1666')).toBe('p4.example:1666');
    expect(normalizeP4Port('ssl://p4.example:1666')).toBe('ssl:p4.example:1666');
    expect(normalizeP4Port('  ssl:p4.example:1666  ')).toBe('ssl:p4.example:1666');
    expect(normalizeP4Port('p4.example:1666')).toBe('p4.example:1666');
  });

  it('strips a stray // from P4PORT before invoking p4', async () => {
    execSync.mockReturnValue([
      '... path C:\\work\\game\\...',
      '',
    ].join('\n'));

    const { findP4WorkspaceRoot } = await import('../src/p4-source.js');

    findP4WorkspaceRoot('//depot/main/...', { p4Port: '//p4.example:1666' });
    expect(execSync).toHaveBeenCalledWith('p4 -ztag where //depot/main/...', expect.objectContaining({
      env: expect.objectContaining({ P4PORT: 'p4.example:1666' }),
    }));
  });

  it('surfaces p4 stderr instead of swallowing failures when listing changelists', async () => {
    const failure = Object.assign(new Error('Command failed'), {
      stderr: 'Perforce client error:\n\tConnect to server failed; check $P4PORT.',
    });
    execSync.mockImplementation(() => { throw failure; });

    const { getRecentChangelists } = await import('../src/p4-source.js');

    expect(() => getRecentChangelists(1, '//depot/main/...')).toThrow(/Connect to server failed/);
  });

  it('reports a clear message when the p4 executable is missing', async () => {
    const enoent = Object.assign(new Error('spawnSync p4 ENOENT'), { code: 'ENOENT' });
    execSync.mockImplementation(() => { throw enoent; });

    const { getRecentChangelists } = await import('../src/p4-source.js');

    expect(() => getRecentChangelists(1, '//depot/main/...')).toThrow(/p4 executable not found/);
  });
});
