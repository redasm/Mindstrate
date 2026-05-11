/**
 * Maintains `<vault>/_meta/index.json`, the registry MCP tooling reads to
 * find every Markdown page produced by the project-graph projection for a
 * given project. Pulled out so the projection writer can stay focused on
 * page rendering.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJsonFile } from '../storage/json-file.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';

export interface ObsidianProjectionIndexEntry {
  key: string;
  path: string | undefined;
  role: string;
  priority: number;
}

export const writeObsidianProjectionIndex = (
  vaultRoot: string,
  projectSlug: string,
  entries: ObsidianProjectionIndexEntry[],
): void => {
  const metaDir = path.join(vaultRoot, '_meta');
  const indexPath = path.join(metaDir, 'index.json');
  fs.mkdirSync(metaDir, { recursive: true });
  const current = readObsidianIndex(indexPath);
  const currentPages = current['projectGraphPages'] && typeof current['projectGraphPages'] === 'object'
    ? current['projectGraphPages'] as Record<string, unknown>
    : {};
  const nextPages = Object.fromEntries(Object.entries(currentPages)
    .filter(([, value]) => !isProjectGraphPageForProject(value, projectSlug)));
  for (const entry of entries) {
    if (!entry.path) continue;
    nextPages[`${projectSlug}:${entry.key}`] = {
      project: projectSlug,
      path: relativePath(vaultRoot, entry.path),
      role: entry.role,
      priority: entry.priority,
    };
  }
  writeProjectGraphTextFileAtomically(indexPath, `${JSON.stringify({
    ...current,
    version: typeof current['version'] === 'number' ? current['version'] : 1,
    files: current['files'] && typeof current['files'] === 'object' ? current['files'] : {},
    projectGraphPages: nextPages,
  }, null, 2)}\n`);
};

const readObsidianIndex = (indexPath: string): Record<string, unknown> => {
  const parsed = readJsonFile<unknown>(indexPath);
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : { files: {}, version: 1 };
};

const isProjectGraphPageForProject = (value: unknown, projectSlug: string): boolean =>
  !!value && typeof value === 'object' && (value as Record<string, unknown>)['project'] === projectSlug;

const relativePath = (root: string, filePath: string): string =>
  path.relative(root, filePath).split(path.sep).join('/');
