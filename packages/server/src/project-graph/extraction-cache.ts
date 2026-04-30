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
  version: 1;
  files: Record<string, ProjectGraphFileExtractionCacheEntry>;
}

const CACHE_PATH = path.join('.mindstrate', 'project-graph-extract-cache.json');

export const readProjectGraphExtractionCache = (projectRoot: string): ProjectGraphFileExtractionCache => {
  const cachePath = path.join(projectRoot, CACHE_PATH);
  if (!fs.existsSync(cachePath)) return emptyCache();
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Partial<ProjectGraphFileExtractionCache>;
    if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== 'object') return emptyCache();
    return { version: 1, files: parsed.files };
  } catch {
    return emptyCache();
  }
};

export const writeProjectGraphExtractionCache = (
  projectRoot: string,
  cache: ProjectGraphFileExtractionCache,
): void => {
  const cachePath = path.join(projectRoot, CACHE_PATH);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
};

export const emptyCache = (): ProjectGraphFileExtractionCache => ({
  version: 1,
  files: {},
});
