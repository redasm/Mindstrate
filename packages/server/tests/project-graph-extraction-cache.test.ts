import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTempDir, removeTempDir } from './test-support.js';
import {
  openProjectGraphExtractionCacheWriter,
  readProjectGraphExtractionCache,
} from '../src/project-graph/extraction-cache.js';

const FILENAME = 'project-graph-extract-cache.ndjson';

describe('project graph extraction cache', () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir('mindstrate-extract-cache-');
  });

  afterEach(() => {
    removeTempDir(root);
  });

  it('defaults to writing inside the scanned tree at .mindstrate/', () => {
    const writer = openProjectGraphExtractionCacheWriter(root);
    writer.write({ path: 'src/a.ts', hash: 'h1', nodes: [], edges: [] });
    writer.close();

    expect(fs.existsSync(path.join(root, '.mindstrate', FILENAME))).toBe(true);
    const cache = readProjectGraphExtractionCache(root);
    expect(cache.files['src/a.ts']?.hash).toBe('h1');
  });

  it('writes to an explicit cacheDir instead of the scanned tree when given', () => {
    // Simulates a read-only / root-owned scanned root (e.g. P4 workspace): the
    // cache must land in the writable cacheDir, and nothing is written under root.
    const cacheDir = createTempDir('mindstrate-extract-cache-out-');
    try {
      const writer = openProjectGraphExtractionCacheWriter(root, cacheDir);
      writer.write({ path: 'src/b.ts', hash: 'h2', nodes: [], edges: [] });
      writer.close();

      expect(fs.existsSync(path.join(cacheDir, FILENAME))).toBe(true);
      expect(fs.existsSync(path.join(root, '.mindstrate'))).toBe(false);

      const cache = readProjectGraphExtractionCache(root, cacheDir);
      expect(cache.files['src/b.ts']?.hash).toBe('h2');
      // Reading without the cacheDir (default location) finds nothing.
      expect(readProjectGraphExtractionCache(root).files['src/b.ts']).toBeUndefined();
    } finally {
      removeTempDir(cacheDir);
    }
  });
});
