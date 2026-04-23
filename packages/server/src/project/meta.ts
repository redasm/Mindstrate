/**
 * Project meta file: `.mindstrate/project.json`
 *
 * Stored at the project root so collaborators can `mindstrate init` the same project
 * without rediscovering its identity. The file is small and safe to commit.
 *
 * Note: only project IDENTITY is here. The actual knowledge (snapshot KU,
 * captured bug fixes, etc.) lives in the central DB / Team Server / Vault.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const PROJECT_META_DIRNAME = '.mindstrate';
export const PROJECT_META_FILENAME = 'project.json';
export const PROJECT_META_VERSION = 1;

export interface ProjectMeta {
  version: number;
  /** Project name (matches DetectedProject.name) */
  name: string;
  /** Project root absolute path at last init (informational; not authoritative) */
  rootHint?: string;
  language?: string;
  framework?: string;
  /** Stable knowledge id for the project snapshot KU (deterministic) */
  snapshotKnowledgeId?: string;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
  /** Last detected dependency-name fingerprint, used to short-circuit work. */
  fingerprint?: string;
}

export function metaPath(projectRoot: string): string {
  return path.join(projectRoot, PROJECT_META_DIRNAME, PROJECT_META_FILENAME);
}

export function loadProjectMeta(projectRoot: string): ProjectMeta | null {
  const p = metaPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ProjectMeta;
  } catch {
    return null;
  }
}

export function saveProjectMeta(projectRoot: string, meta: ProjectMeta): void {
  const dir = path.join(projectRoot, PROJECT_META_DIRNAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(projectRoot), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  // Make sure the local DB / vector files aren't committed by accident.
  const giPath = path.join(dir, '.gitignore');
  const giContent = [
    '# Mindstrate local data — not for git',
    'mindstrate.db',
    'mindstrate.db-journal',
    'mindstrate.db-wal',
    'mindstrate.db-shm',
    'vectors/',
    '',
    '# Project identity is safe to commit:',
    '!project.json',
    '',
  ].join('\n');
  if (!fs.existsSync(giPath)) {
    fs.writeFileSync(giPath, giContent, 'utf8');
  }
}

/**
 * Compute a stable fingerprint for a list of dependency names + language +
 * framework. Used to skip snapshot regeneration when nothing meaningful changed.
 */
export function dependencyFingerprint(input: {
  language?: string;
  framework?: string;
  dependencies: { name: string }[];
}): string {
  const sorted = input.dependencies.map((d) => d.name).sort().join(',');
  return `${input.language ?? ''}|${input.framework ?? ''}|${sorted}`;
}
