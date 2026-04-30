/**
 * Vault layout: file path strategy for Knowledge Units inside an Obsidian vault.
 *
 * Layout chosen by the user: by-project / by-type
 *
 *   <vaultRoot>/
 *     <projectName>/
 *       bug-fixes/
 *         <slug>--<id8>.md
 *       best-practices/
 *         ...
 *       _meta/
 *         index.json   (id -> relative path mapping; used to detect renames)
 *
 * Knowledge with no project goes under `_global/`.
 *
 * The id-suffix in filenames (`<slug>--<id8>.md`) lets users rename freely
 * while keeping the filename unique and id-recoverable.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { type GraphKnowledgeView, KnowledgeType } from '@mindstrate/server';

const TYPE_FOLDERS: Record<KnowledgeType, string> = {
  [KnowledgeType.BUG_FIX]: 'bug-fixes',
  [KnowledgeType.BEST_PRACTICE]: 'best-practices',
  [KnowledgeType.ARCHITECTURE]: 'architecture',
  [KnowledgeType.CONVENTION]: 'conventions',
  [KnowledgeType.PATTERN]: 'patterns',
  [KnowledgeType.TROUBLESHOOTING]: 'troubleshooting',
  [KnowledgeType.GOTCHA]: 'gotchas',
  [KnowledgeType.HOW_TO]: 'how-to',
  [KnowledgeType.WORKFLOW]: 'workflows',
};

export const GLOBAL_PROJECT_FOLDER = '_global';
export const META_FOLDER = '_meta';
export const INDEX_FILE = 'index.json';

export interface VaultLayoutOptions {
  /** Root directory of the obsidian vault */
  vaultRoot: string;
}

export interface VaultIndex {
  /** Map: knowledge-id -> relative file path inside vault (forward slashes) */
  files: Record<string, string>;
  /** Last full sync timestamp */
  lastFullSyncAt?: string;
  /** Schema version */
  version: number;
}

const INDEX_SCHEMA_VERSION = 1;

export class VaultLayout {
  readonly root: string;

  constructor(opts: VaultLayoutOptions) {
    this.root = path.resolve(opts.vaultRoot);
  }

  relativePathForGraphView(k: GraphKnowledgeView): string {
    const project = sanitizeFolder(k.project) || GLOBAL_PROJECT_FOLDER;
    const type = graphDomainToKnowledgeType(String(k.domainType));
    const typeFolder = TYPE_FOLDERS[type] ?? 'misc';
    const filename = makeFilename(k.title, k.id);
    return joinForward(project, typeFolder, filename);
  }

  absolutePath(relPath: string): string {
    return path.join(this.root, ...relPath.split('/'));
  }

  /** Ensure the vault root and meta folder exist. */
  ensureRoot(): void {
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
    const metaDir = path.join(this.root, META_FOLDER);
    if (!fs.existsSync(metaDir)) {
      fs.mkdirSync(metaDir, { recursive: true });
    }
  }

  ensureDirFor(relPath: string): void {
    const abs = this.absolutePath(relPath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // -------- index --------

  loadIndex(): VaultIndex {
    const file = path.join(this.root, META_FOLDER, INDEX_FILE);
    if (!fs.existsSync(file)) {
      return { files: {}, version: INDEX_SCHEMA_VERSION };
    }
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        files: parsed.files ?? {},
        lastFullSyncAt: parsed.lastFullSyncAt,
        version: parsed.version ?? INDEX_SCHEMA_VERSION,
      };
    } catch {
      return { files: {}, version: INDEX_SCHEMA_VERSION };
    }
  }

  saveIndex(idx: VaultIndex): void {
    this.ensureRoot();
    const file = path.join(this.root, META_FOLDER, INDEX_FILE);
    fs.writeFileSync(file, JSON.stringify(idx, null, 2), 'utf8');
  }

  /** Walk the vault and return all markdown files under it (relative paths). */
  walkMarkdownFiles(): string[] {
    const out: string[] = [];
    const ignored = new Set([META_FOLDER, '.obsidian', '.trash', 'node_modules']);
    const walk = (dir: string, rel: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        if (ent.name.startsWith('.') && ent.name !== '.') continue;
        if (ignored.has(ent.name)) continue;
        const full = path.join(dir, ent.name);
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          walk(full, r);
        } else if (ent.isFile() && ent.name.endsWith('.md')) {
          out.push(r);
        }
      }
    };
    if (fs.existsSync(this.root)) walk(this.root, '');
    return out;
  }

  /** True if the given absolute path is inside meta folder (should be ignored). */
  isMetaPath(absOrRel: string): boolean {
    const rel = path.isAbsolute(absOrRel) ? path.relative(this.root, absOrRel) : absOrRel;
    const norm = rel.split(path.sep).join('/');
    return norm.startsWith(`${META_FOLDER}/`) || norm === META_FOLDER;
  }
}

export function graphDomainToKnowledgeType(domainType: string): KnowledgeType {
  if (domainType === 'project_snapshot') return KnowledgeType.ARCHITECTURE;
  if (domainType === 'session_summary') return KnowledgeType.WORKFLOW;
  return Object.values(KnowledgeType).includes(domainType as KnowledgeType)
    ? domainType as KnowledgeType
    : KnowledgeType.BEST_PRACTICE;
}

// ============================================================
// Helpers
// ============================================================

const SLUG_MAX = 60;

function makeFilename(title: string, id: string): string {
  const slug = slugify(title) || 'untitled';
  const idSuffix = hashIdSuffix(id);
  return `${slug}--${idSuffix}.md`;
}

/** Extract knowledge id (or id prefix) from a filename, returns undefined if absent. */
export function extractIdSuffixFromFilename(name: string): string | undefined {
  const base = name.replace(/\.md$/i, '');
  const m = base.match(/--([a-f0-9]{6,})$/i);
  return m?.[1]?.toLowerCase();
}

/** Match a real KU id against a id-prefix found in a filename. */
export function idMatchesSuffix(id: string, suffix: string): boolean {
  const normalizedSuffix = suffix.toLowerCase();
  return id.replace(/-/g, '').toLowerCase().startsWith(normalizedSuffix)
    || hashIdSuffix(id).startsWith(normalizedSuffix);
}

function hashIdSuffix(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
  return base;
}

function sanitizeFolder(name: string | undefined): string {
  if (!name) return '';
  return name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function joinForward(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}
