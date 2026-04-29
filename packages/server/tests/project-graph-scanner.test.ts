import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  diffProjectGraphCache,
  estimateProjectGraphScanScope,
  scanProjectFiles,
  type ProjectFileInventoryEntry,
} from '../src/project-graph/scanner.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph scanner', () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir('mindstrate-project-graph-scan-');
  });

  afterEach(() => {
    removeTempDir(root);
  });

  it('builds a hashed inventory while respecting default and configured ignores', () => {
    write(root, '.gitignore', 'ignored.log\nlocal-cache/\n');
    write(root, '.mindstrateignore', 'private/\n');
    write(root, 'package.json', '{"name":"demo"}');
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    write(root, 'src/notes.md', '# Decision\n\nUse parser facts.');
    write(root, 'ignored.log', 'nope');
    write(root, 'local-cache/file.ts', 'nope');
    write(root, 'private/secret.ts', 'nope');
    write(root, 'node_modules/lib/index.js', 'nope');
    write(root, 'dist/bundle.js', 'nope');
    write(root, 'Generated/out.ts', 'nope');

    const entries = scanProjectFiles(root, {
      ignore: ['Generated'],
      generatedRoots: ['Intermediate'],
    });
    const paths = entries.map((entry) => entry.path).sort();

    expect(paths).toEqual(['package.json', 'src/App.tsx', 'src/notes.md']);
    expect(entries.find((entry) => entry.path === 'src/App.tsx')).toMatchObject({
      extension: '.tsx',
      language: 'tsx',
      generated: false,
    });
    expect(entries.find((entry) => entry.path === 'src/notes.md')?.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('detects added, changed, unchanged, and deleted cache entries', () => {
    const previous: ProjectFileInventoryEntry[] = [
      makeEntry('src/a.ts', 'hash-a'),
      makeEntry('src/b.ts', 'old-hash-b'),
      makeEntry('src/deleted.ts', 'hash-deleted'),
    ];
    const current: ProjectFileInventoryEntry[] = [
      makeEntry('src/a.ts', 'hash-a'),
      makeEntry('src/b.ts', 'new-hash-b'),
      makeEntry('src/c.ts', 'hash-c'),
    ];

    expect(diffProjectGraphCache(previous, current)).toEqual({
      added: [current[2]],
      changed: [current[1]],
      unchanged: [current[0]],
      deleted: [previous[2]],
    });
  });

  it('estimates scan scope before project graph indexing starts', () => {
    write(root, 'package.json', '{"name":"demo"}');
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    write(root, 'src/server.ts', 'export const port = 3000;');
    write(root, 'README.md', '# Demo');
    write(root, 'node_modules/lib/index.js', 'ignored');

    const scope = estimateProjectGraphScanScope(root, {
      generatedRoots: ['dist'],
      llmProviderConfigured: true,
    });

    expect(scope.filesToScan).toBe(4);
    expect(scope.totalBytes).toBeGreaterThan(0);
    expect(scope.languages).toEqual({
      json: 1,
      markdown: 1,
      tsx: 1,
      typescript: 1,
    });
    expect(scope.ignoredDirectories).toContain('node_modules');
    expect(scope.ignoredDirectories).toContain('dist');
    expect(scope.llmEnrichment).toBe('enabled');
  });
});

const makeEntry = (relPath: string, hash: string): ProjectFileInventoryEntry => ({
  path: relPath,
  absolutePath: `C:/repo/${relPath}`,
  size: 1,
  extension: path.extname(relPath),
  hash,
  modifiedTime: '2026-04-29T00:00:00.000Z',
  language: relPath.endsWith('.ts') ? 'typescript' : undefined,
  generated: false,
});
