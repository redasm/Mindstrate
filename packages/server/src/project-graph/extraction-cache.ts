import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectGraphEdgeDto, ProjectGraphNodeDto } from '@mindstrate/protocol/models';

export interface ProjectGraphFileExtractionCacheEntry {
  path: string;
  hash: string;
  nodes: ProjectGraphNodeDto[];
  edges: ProjectGraphEdgeDto[];
}

export interface ProjectGraphFileExtractionCache {
  version: typeof CACHE_VERSION;
  files: Record<string, ProjectGraphFileExtractionCacheEntry>;
}

/**
 * Bumped to 3 when the cache moved from a single JSON document to a streamed
 * NDJSON log (header line `{"version":3}` followed by one entry per line).
 *
 * The old format buffered every file's extracted nodes/edges in one in-memory
 * object until the end of the index, then serialized it all at once — on a
 * first-run index of a 100k+ node checkout that second full copy of the graph
 * was a large slice of the heap that pushed the scanner into OOM. Streaming one
 * line per file as we go lets each file's duplicate facts be garbage-collected
 * once they've been merged into the deduped in-memory graph.
 */
const CACHE_VERSION = 3;
const CACHE_PATH = path.join('.mindstrate', 'project-graph-extract-cache.ndjson');

export const readProjectGraphExtractionCache = (projectRoot: string): ProjectGraphFileExtractionCache => {
  const cachePath = path.join(projectRoot, CACHE_PATH);
  let raw: string;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch {
    return emptyCache();
  }

  const files: Record<string, ProjectGraphFileExtractionCacheEntry> = {};
  let headerSeen = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!headerSeen) {
      headerSeen = true;
      let header: unknown;
      try {
        header = JSON.parse(trimmed);
      } catch {
        return emptyCache();
      }
      if (!header || typeof header !== 'object' || (header as { version?: unknown }).version !== CACHE_VERSION) {
        return emptyCache();
      }
      continue;
    }
    let entry: ProjectGraphFileExtractionCacheEntry;
    try {
      entry = JSON.parse(trimmed) as ProjectGraphFileExtractionCacheEntry;
    } catch {
      // A torn final line from a crashed run — keep the entries parsed so far
      // rather than discarding the whole cache.
      continue;
    }
    if (entry && typeof entry.path === 'string') files[entry.path] = entry;
  }

  if (!headerSeen) return emptyCache();
  return { version: CACHE_VERSION, files };
};

export interface ProjectGraphExtractionCacheWriter {
  write(entry: ProjectGraphFileExtractionCacheEntry): void;
  close(): void;
}

/**
 * Opens the cache for streamed writing, truncating any previous cache. Entries
 * are flushed one line at a time so the indexer never has to hold a second copy
 * of the graph in memory, and a crash mid-index leaves a still-readable partial
 * cache (see {@link readProjectGraphExtractionCache}).
 */
export const openProjectGraphExtractionCacheWriter = (
  projectRoot: string,
): ProjectGraphExtractionCacheWriter => {
  const cachePath = path.join(projectRoot, CACHE_PATH);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const fd = fs.openSync(cachePath, 'w');
  fs.writeSync(fd, `${JSON.stringify({ version: CACHE_VERSION })}\n`);
  let closed = false;
  return {
    write(entry: ProjectGraphFileExtractionCacheEntry): void {
      if (closed) return;
      fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
    },
    close(): void {
      if (closed) return;
      closed = true;
      fs.closeSync(fd);
    },
  };
};

export const emptyCache = (): ProjectGraphFileExtractionCache => ({
  version: CACHE_VERSION,
  files: {},
});
