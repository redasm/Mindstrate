import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  buildProjectGraphScanPlan,
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
    write(root, '.vs/Client/FileContentIndex/index.vsidx', 'locked by Visual Studio');
    write(root, 'Generated/out.ts', 'nope');
    write(root, 'TypeScript/Typing/ue/generated/Script/Engine/Actor.d.ts', 'declare class Actor {}');
    write(root, 'TypeScript/Typing/Game/Foo.d.ts', 'declare class Foo {}');

    const entries = scanProjectFiles(root, {
      ignore: ['Generated', 'TypeScript/Typing'],
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

  it('skips files that become unreadable during scanning', () => {
    write(root, 'package.json', '{"name":"demo"}');
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    write(root, 'src/locked.ts', 'export const locked = true;');
    const lockedPath = path.join(root, 'src', 'locked.ts');
    const paths = scanProjectFiles(root, {
      readFile: (filePath) => {
        if (path.resolve(filePath) !== lockedPath) return fs.readFileSync(filePath);
        const error = new Error('resource busy or locked') as NodeJS.ErrnoException;
        error.code = 'EBUSY';
        throw error;
      },
    });

    expect(paths.map((entry) => entry.path)).toEqual(['package.json', 'src/App.tsx']);
  });

  it('reports progress while walking project files', () => {
    write(root, 'package.json', '{"name":"demo"}');
    write(root, 'src/App.tsx', 'export function App() { return <main />; }');
    write(root, 'src/server.ts', 'export const port = 3000;');
    const progress: string[] = [];

    scanProjectFiles(root, {
      onProgress: (event) => progress.push(`${event.phase}:${event.path}:${event.files}:${event.directories}`),
    });

    expect(progress).toContain('directory:src:1:2');
    expect(progress).toContain('file:src/App.tsx:2:2');
    expect(progress).toContain('file:src/server.ts:3:2');
  });

  it('plans mixed projects without expanding generated or metadata-only roots', () => {
    write(root, 'Client.uproject', '{"FileVersion":3}');
    write(root, 'Source/Game/Player.cpp', 'void Fire() {}');
    write(root, 'Config/DefaultGame.ini', '[/Script/EngineSettings.GeneralProjectSettings]');
    write(root, 'Scripts/Lua/inventory.lua', 'return {}');
    write(root, 'Content/UI/WBP_MainMenu.uasset', 'binary');
    write(root, 'TypeScript/Typing/ue/generated/Script/Engine/Actor.d.ts', 'declare class Actor {}');
    write(root, 'TypeScript/Typing/Game/Foo.d.ts', 'declare class Foo {}');
    write(root, 'Plugins/ThirdParty/SDK/generated.h', 'nope');

    const entries = scanProjectFiles(root, {
      sourceRoots: ['Source', 'Config', 'Scripts'],
      manifests: ['*.uproject'],
      generatedRoots: ['TypeScript/Typing'],
      ignore: ['Plugins/ThirdParty'],
      metadataOnlyRoots: ['Content'],
    });
    const plan = buildProjectGraphScanPlan(root, {
      sourceRoots: ['Source', 'Config', 'Scripts'],
      manifests: ['*.uproject'],
      generatedRoots: ['TypeScript/Typing'],
      ignore: ['Plugins/ThirdParty'],
      metadataOnlyRoots: ['Content'],
    });

    expect(entries.map((entry) => entry.path).sort()).toEqual([
      'Client.uproject',
      'Config/DefaultGame.ini',
      'Scripts/Lua/inventory.lua',
      'Source/Game/Player.cpp',
    ]);
    expect(plan.deepRoots).toEqual(['Config', 'Scripts', 'Source']);
    expect(plan.metadataOnlyRoots).toEqual(['Content']);
    expect(plan.generatedRoots).toContain('TypeScript/Typing');
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
