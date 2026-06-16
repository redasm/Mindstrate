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

  it('logs in to mint a ticket and retries when a plaintext password is rejected', async () => {
    const authError = Object.assign(new Error('Command failed'), {
      stderr: 'Perforce password (P4PASSWD) invalid or unset.',
    });
    execSync
      .mockImplementationOnce(() => { throw authError; })                                  // p4 changes (plaintext) -> rejected
      .mockImplementationOnce(() => 'User svc logged in.\nABCDEF0123456789ABCDEF0123456789\n') // p4 login -p -> ticket
      .mockImplementationOnce(() => 'Change 42 on 2024/01/01 by svc@ws\n');                // p4 changes (ticket) -> ok

    const { getRecentChangelists } = await import('../src/p4-source.js');

    const result = getRecentChangelists(1, '//depot/main/...', {
      p4Port: 'p4.example:1666',
      p4User: 'svc',
      p4Passwd: 'plaintextpw',
    });

    expect(result).toEqual(['42']);
    expect(execSync).toHaveBeenNthCalledWith(2, 'p4 login -p', expect.objectContaining({
      input: expect.stringContaining('plaintextpw'),
    }));
    expect(execSync).toHaveBeenNthCalledWith(3, expect.stringContaining('p4 changes'), expect.objectContaining({
      env: expect.objectContaining({ P4PASSWD: 'ABCDEF0123456789ABCDEF0123456789' }),
    }));
  });

  it('does not attempt login when the configured secret is already a ticket', async () => {
    const authError = Object.assign(new Error('Command failed'), {
      stderr: 'Perforce password (P4PASSWD) invalid or unset.',
    });
    execSync.mockImplementation(() => { throw authError; });

    const { getRecentChangelists } = await import('../src/p4-source.js');

    expect(() => getRecentChangelists(1, '//depot/main/...', {
      p4Port: 'p4.example:1666',
      p4User: 'svc',
      p4Passwd: 'ABCDEF0123456789ABCDEF0123456789',
    })).toThrow(/invalid or unset/);
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync).not.toHaveBeenCalledWith('p4 login -p', expect.anything());
  });

  it('appends the ... wildcard to a directory depot path for p4 changes', async () => {
    execSync.mockReturnValue('Change 7 on 2024/01/01 by svc@ws\n');

    const { getRecentChangelists } = await import('../src/p4-source.js');

    expect(getRecentChangelists(1, '//depot/main/Source/Client')).toEqual(['7']);
    expect(execSync).toHaveBeenCalledWith(
      'p4 changes -s submitted -m 1 //depot/main/Source/Client/...',
      expect.anything(),
    );
  });

  it('leaves a depot path that already ends in ... unchanged', async () => {
    execSync.mockReturnValue('');

    const { getRecentChangelists } = await import('../src/p4-source.js');

    getRecentChangelists(1, '//depot/main/...');
    expect(execSync).toHaveBeenCalledWith(
      'p4 changes -s submitted -m 1 //depot/main/...',
      expect.anything(),
    );
  });
});
