/**
 * Curated project documentation collector.
 *
 * The system-page LLM planner is deliberately grounded in EXTRACTED graph
 * facts and refuses to invent files/subsystems. But many teams keep
 * hand-written, authoritative architecture documentation inside the checkout
 * (e.g. `AiAgent/Docs`, `AiAgent/Instructions`, `docs/`). That curated prose is
 * exactly the high-signal context that turns generic placeholder pages into
 * project-specific ones.
 *
 * This module reads bounded excerpts of those docs so they can be passed to the
 * planner as additional, trusted evidence. Everything is conservatively bounded
 * so a huge `docs/` tree can never blow up the planning payload.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedProject } from '../project/index.js';

export interface CuratedProjectDoc {
  /** Repo-relative, posix-style path — used as a citable evidence path. */
  path: string;
  /** First markdown heading, or the file name when none is present. */
  title: string;
  /** Bounded, whitespace-normalized excerpt of the document body. */
  excerpt: string;
}

export interface CollectCuratedProjectDocsOptions {
  /** Repo-relative roots to scan. Defaults to common architecture-doc roots. */
  roots?: string[];
  maxDocs?: number;
  maxCharsPerDoc?: number;
  maxTotalChars?: number;
  maxDepth?: number;
  maxFileBytes?: number;
}

// Conventional locations for human-authored architecture/convention docs. The
// AiAgent roots are first because, when present, they are the team's curated
// source of truth and should win the per-root document budget.
const DEFAULT_CURATED_DOC_ROOTS = [
  'AiAgent/Docs',
  'AiAgent/Instructions',
  'docs',
  'Docs',
  'documentation',
  '.mindstrate/docs',
];

const DEFAULTS = {
  maxDocs: 16,
  maxCharsPerDoc: 1500,
  maxTotalChars: 20000,
  maxDepth: 4,
  maxFileBytes: 256 * 1024,
} as const;

/**
 * Collect bounded excerpts of curated markdown docs under the project root.
 * Returns an empty array when no curated docs are found (the planner then runs
 * on extracted facts alone, exactly as before).
 */
export const collectCuratedProjectDocs = (
  project: DetectedProject,
  options: CollectCuratedProjectDocsOptions = {},
): CuratedProjectDoc[] => {
  const roots = options.roots ?? curatedDocRootsForProject(project);
  const maxDocs = options.maxDocs ?? DEFAULTS.maxDocs;
  const maxCharsPerDoc = options.maxCharsPerDoc ?? DEFAULTS.maxCharsPerDoc;
  const maxTotalChars = options.maxTotalChars ?? DEFAULTS.maxTotalChars;
  const maxDepth = options.maxDepth ?? DEFAULTS.maxDepth;
  const maxFileBytes = options.maxFileBytes ?? DEFAULTS.maxFileBytes;

  const docs: CuratedProjectDoc[] = [];
  let totalChars = 0;

  for (const root of roots) {
    if (docs.length >= maxDocs || totalChars >= maxTotalChars) break;
    const absRoot = path.resolve(project.root, root);
    if (!isReadableDir(absRoot)) continue;

    for (const file of listMarkdownFiles(absRoot, maxDepth)) {
      if (docs.length >= maxDocs || totalChars >= maxTotalChars) break;
      const doc = readCuratedDoc(project.root, file, maxCharsPerDoc, maxFileBytes);
      if (!doc) continue;
      docs.push(doc);
      totalChars += doc.excerpt.length;
    }
  }

  return docs;
};

export const curatedDocRootsForProject = (project: DetectedProject): string[] => {
  const hinted = (project.graphHints as { curatedDocRoots?: unknown } | undefined)?.curatedDocRoots;
  if (Array.isArray(hinted)) {
    const roots = hinted.filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
    if (roots.length > 0) return roots;
  }
  return DEFAULT_CURATED_DOC_ROOTS;
};

const isReadableDir = (dir: string): boolean => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Depth-first list of `.md` files under `root`, sorted for deterministic order. */
const listMarkdownFiles = (root: string, maxDepth: number): string[] => {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(full);
      }
    }
  };
  walk(root, 0);
  return files;
};

const readCuratedDoc = (
  projectRoot: string,
  absFile: string,
  maxCharsPerDoc: number,
  maxFileBytes: number,
): CuratedProjectDoc | null => {
  let raw: string;
  try {
    if (fs.statSync(absFile).size > maxFileBytes) return null;
    raw = fs.readFileSync(absFile, 'utf8');
  } catch {
    return null;
  }
  const body = raw.trim();
  if (body.length === 0) return null;

  const relPath = path.relative(projectRoot, absFile).split(path.sep).join('/');
  return {
    path: relPath,
    title: deriveTitle(body, path.basename(absFile)),
    excerpt: normalizeExcerpt(body, maxCharsPerDoc),
  };
};

const deriveTitle = (body: string, fileName: string): string => {
  for (const line of body.split('\n')) {
    const match = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (match) return match[1].trim().slice(0, 200);
  }
  return fileName.replace(/\.md$/i, '');
};

const normalizeExcerpt = (body: string, maxChars: number): string => {
  const collapsed = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return collapsed.length > maxChars ? collapsed.slice(0, maxChars) + '\n…(truncated)' : collapsed;
};
