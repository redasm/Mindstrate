/**
 * Regression tests for the local data dir resolver.
 *
 * MCP server in local mode used to always default to `~/.mindstrate`,
 * causing project-local CLI commands (mindstrate setup / init) and the
 * MCP server to write to two different SQLite files. This resolver
 * picks the project-local .mindstrate when it exists, so both stay in
 * sync.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveLocalDataDir } from '../src/local-data-dir.js';

describe('resolveLocalDataDir', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-resolve-'));
    originalEnv = process.env['MINDSTRATE_DATA_DIR'];
    delete process.env['MINDSTRATE_DATA_DIR'];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env['MINDSTRATE_DATA_DIR'] = originalEnv;
    } else {
      delete process.env['MINDSTRATE_DATA_DIR'];
    }
  });

  it('honors an explicit MINDSTRATE_DATA_DIR override', () => {
    process.env['MINDSTRATE_DATA_DIR'] = '/custom/data/dir';
    expect(resolveLocalDataDir({ cwd: tempDir })).toBe('/custom/data/dir');
  });

  it('picks <cwd>/.mindstrate when it exists', () => {
    const projectData = path.join(tempDir, '.mindstrate');
    fs.mkdirSync(projectData);

    expect(resolveLocalDataDir({ cwd: tempDir })).toBe(projectData);
  });

  it('walks up to the first ancestor with a .mindstrate directory', () => {
    const projectRoot = tempDir;
    const projectData = path.join(projectRoot, '.mindstrate');
    fs.mkdirSync(projectData);

    const nested = path.join(projectRoot, 'packages', 'server', 'src');
    fs.mkdirSync(nested, { recursive: true });

    expect(resolveLocalDataDir({ cwd: nested })).toBe(projectData);
  });

  it('falls back (returns undefined to let Mindstrate use its built-in home default) when no project-local .mindstrate is found', () => {
    // tempDir has no `.mindstrate` subdir. The home directory's
    // `.mindstrate` (if it exists on the developer's machine) must
    // never be picked here — it is the global fallback, not a
    // project-local match.
    expect(resolveLocalDataDir({ cwd: tempDir })).toBeUndefined();
  });

  it('does not mistake ~/.mindstrate for a project-local match when walking up reaches the home directory', () => {
    // Construct a path under the home directory and verify we do not
    // accidentally claim the home `.mindstrate` (if it happens to
    // exist) as a project-local store. The walk should still return
    // undefined because no real project ancestor has its own
    // `.mindstrate`.
    const home = os.homedir();
    // Use a synthetic path under home that almost certainly has no
    // .mindstrate ancestor of its own. If the developer's home has
    // .mindstrate the resolver must still return undefined for this
    // cwd (the resolver is documented to skip the home directory
    // match because that is the global fallback).
    const subPath = path.join(home, '__mindstrate_test_does_not_exist__');
    const result = resolveLocalDataDir({ cwd: subPath });
    // The result is either undefined (no project ancestor) or some
    // ancestor BETWEEN subPath and home — but never `~/.mindstrate`
    // itself.
    if (result !== undefined) {
      expect(result).not.toBe(path.join(home, '.mindstrate'));
    }
  });
});
