import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectGraphEdgeDto, ProjectGraphNodeDto } from '@mindstrate/protocol/models';
import { readJsonFile } from '../storage/json-file.js';

export interface ProjectGraphFileExtractionCacheEntry {
  path: string;
  hash: string;
  nodes: ProjectGraphNodeDto[];
  edges: ProjectGraphEdgeDto[];
}

export interface ProjectGraphFileExtractionCache {
  version: 2;
  files: Record<string, ProjectGraphFileExtractionCacheEntry>;
}

const CACHE_PATH = path.join('.mindstrate', 'project-graph-extract-cache.json');

export const readProjectGraphExtractionCache = (projectRoot: string): ProjectGraphFileExtractionCache => {
  const cachePath = path.join(projectRoot, CACHE_PATH);
  const parsed = readJsonFile<Partial<ProjectGraphFileExtractionCache>>(cachePath);
  if (!parsed || parsed.version !== 2 || !parsed.files || typeof parsed.files !== 'object') {
    return emptyCache();
  }
  return { version: 2, files: parsed.files };
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
  version: 2,
  files: {},
});
