import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProjectFileInventoryEntry {
  path: string;
  absolutePath: string;
  size: number;
  extension: string;
  hash: string;
  modifiedTime: string;
  language?: string;
  layerId?: string;
  generated: boolean;
}

export interface ScanProjectFilesOptions {
  ignore?: string[];
  generatedRoots?: string[];
}

export interface ProjectGraphCacheDiff {
  added: ProjectFileInventoryEntry[];
  changed: ProjectFileInventoryEntry[];
  unchanged: ProjectFileInventoryEntry[];
  deleted: ProjectFileInventoryEntry[];
}

const DEFAULT_IGNORES = [
  '.git',
  '.gitignore',
  '.mindstrate',
  '.mindstrateignore',
  'node_modules',
  'dist',
  'build',
  '.next',
  'Binaries',
  'Intermediate',
  'Saved',
  'DerivedDataCache',
];

export const scanProjectFiles = (
  root: string,
  options: ScanProjectFilesOptions = {},
): ProjectFileInventoryEntry[] => {
  const resolvedRoot = path.resolve(root);
  const ignoreRules = loadIgnoreRules(resolvedRoot, options);
  const entries: ProjectFileInventoryEntry[] = [];

  walkProject(resolvedRoot, '', ignoreRules, options.generatedRoots ?? [], entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
};

export const diffProjectGraphCache = (
  previous: ProjectFileInventoryEntry[],
  current: ProjectFileInventoryEntry[],
): ProjectGraphCacheDiff => {
  const previousByPath = new Map(previous.map((entry) => [entry.path, entry]));
  const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
  const added: ProjectFileInventoryEntry[] = [];
  const changed: ProjectFileInventoryEntry[] = [];
  const unchanged: ProjectFileInventoryEntry[] = [];
  const deleted: ProjectFileInventoryEntry[] = [];

  for (const entry of current) {
    const old = previousByPath.get(entry.path);
    if (!old) {
      added.push(entry);
    } else if (old.hash === entry.hash) {
      unchanged.push(entry);
    } else {
      changed.push(entry);
    }
  }

  for (const entry of previous) {
    if (!currentByPath.has(entry.path)) deleted.push(entry);
  }

  return { added, changed, unchanged, deleted };
};

const walkProject = (
  root: string,
  relDir: string,
  ignoreRules: IgnoreRule[],
  generatedRoots: string[],
  entries: ProjectFileInventoryEntry[],
): void => {
  const absDir = path.join(root, relDir);
  for (const dirent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = normalizePath(relDir ? path.join(relDir, dirent.name) : dirent.name);
    if (isIgnored(rel, dirent.isDirectory(), ignoreRules)) continue;

    const abs = path.join(root, rel);
    if (dirent.isDirectory()) {
      walkProject(root, rel, ignoreRules, generatedRoots, entries);
      continue;
    }
    if (!dirent.isFile()) continue;

    const stat = fs.statSync(abs);
    const content = fs.readFileSync(abs);
    const extension = path.extname(rel);
    entries.push({
      path: rel,
      absolutePath: abs,
      size: stat.size,
      extension,
      hash: createHash('sha256').update(content).digest('hex'),
      modifiedTime: stat.mtime.toISOString(),
      language: languageForExtension(extension),
      generated: isUnderAnyRoot(rel, generatedRoots),
    });
  }
};

interface IgnoreRule {
  pattern: string;
  directoryOnly: boolean;
}

const loadIgnoreRules = (root: string, options: ScanProjectFilesOptions): IgnoreRule[] => [
  ...DEFAULT_IGNORES.map((pattern) => ({ pattern, directoryOnly: false })),
  ...(options.ignore ?? []).map((pattern) => ({ pattern, directoryOnly: false })),
  ...(options.generatedRoots ?? []).map((pattern) => ({ pattern, directoryOnly: false })),
  ...readIgnoreFile(path.join(root, '.gitignore')),
  ...readIgnoreFile(path.join(root, '.mindstrateignore')),
];

const readIgnoreFile = (filePath: string): IgnoreRule[] => {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => ({
      pattern: normalizePath(line.replace(/\/$/, '')),
      directoryOnly: line.endsWith('/'),
    }));
};

const isIgnored = (rel: string, isDirectory: boolean, rules: IgnoreRule[]): boolean =>
  rules.some((rule) => {
    if (rule.directoryOnly && !isDirectory && !rel.startsWith(`${rule.pattern}/`)) return false;
    return matchesRule(rel, rule.pattern);
  });

const matchesRule = (rel: string, pattern: string): boolean => {
  if (rel === pattern || rel.startsWith(`${pattern}/`)) return true;
  if (!pattern.includes('*')) return path.basename(rel) === pattern;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`(^|/)${escaped}($|/)`).test(rel);
};

const isUnderAnyRoot = (rel: string, roots: string[]): boolean =>
  roots.map(normalizePath).some((root) => rel === root || rel.startsWith(`${root}/`));

const languageForExtension = (extension: string): string | undefined => {
  if (extension === '.ts') return 'typescript';
  if (extension === '.tsx') return 'tsx';
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return 'javascript';
  if (extension === '.jsx') return 'jsx';
  if (extension === '.vue') return 'vue';
  if (extension === '.md' || extension === '.mdx') return 'markdown';
  if (extension === '.json') return 'json';
  if (extension === '.cpp' || extension === '.cc' || extension === '.cxx') return 'cpp';
  if (extension === '.h' || extension === '.hpp') return 'cpp';
  if (extension === '.cs') return 'csharp';
  return undefined;
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
