import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  buildProjectGraphScanPlan,
  findUnscannedTopLevelDirectories,
  scanProjectFiles,
  type ProjectGraphSkipEvent,
} from '../src/project-graph/scanner.js';

const write = (root: string, rel: string, content: string): void => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

describe('project graph scan coverage diagnostics', () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir('mindstrate-scan-coverage-');
  });

  afterEach(() => {
    removeTempDir(root);
  });

  it('records configured sourceRoots that do not exist on disk', () => {
    write(root, 'src/App.tsx', 'export const App = () => null;');

    const plan = buildProjectGraphScanPlan(root, { sourceRoots: ['src', 'app', 'pages'] });

    expect(plan.requestedSourceRoots).toEqual(['app', 'pages', 'src']);
    expect(plan.deepRoots).toEqual(['src']);
    expect(plan.missingSourceRoots).toEqual(['app', 'pages']);
  });

  it('flags top-level source dirs that a restricted scan never descends into', () => {
    write(root, 'src/App.tsx', 'export const App = () => null;');
    write(root, 'lib/util.ts', 'export const x = 1;');
    write(root, 'server/main.ts', 'export const y = 2;');
    write(root, 'node_modules/dep/index.js', 'module.exports = {};');

    const options = { sourceRoots: ['src'] };
    const plan = buildProjectGraphScanPlan(root, options);
    const unscanned = findUnscannedTopLevelDirectories(root, plan, options);

    // src is deep-scanned; node_modules is a default ignore; lib + server are
    // source dirs the restricted scan silently misses.
    expect(unscanned).toEqual(['lib', 'server']);
  });

  it('reports nothing unscanned when the whole tree is walked (no sourceRoots)', () => {
    write(root, 'src/App.tsx', 'export const App = () => null;');
    write(root, 'lib/util.ts', 'export const x = 1;');

    const plan = buildProjectGraphScanPlan(root, {});
    expect(plan.deepRoots).toEqual([]);
    expect(findUnscannedTopLevelDirectories(root, plan, {})).toEqual([]);
  });

  it('emits a skip event with reason and size for oversized files', () => {
    write(root, 'src/small.ts', 'export const a = 1;');
    write(root, 'src/big.ts', `export const blob = ${JSON.stringify('x'.repeat(2_500_000))};`);

    const skips: ProjectGraphSkipEvent[] = [];
    const entries = scanProjectFiles(root, {
      sourceRoots: ['src'],
      onSkip: (event) => skips.push(event),
    });

    expect(entries.map((entry) => entry.path)).toEqual(['src/small.ts']);
    const oversized = skips.find((event) => event.reason === 'oversized');
    expect(oversized?.path).toBe('src/big.ts');
    expect(oversized?.sizeBytes).toBeGreaterThan(2 * 1024 * 1024);
  });
});
