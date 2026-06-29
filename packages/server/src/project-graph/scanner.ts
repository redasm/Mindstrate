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
  sourceRoots?: string[];
  ignore?: string[];
  generatedRoots?: string[];
  metadataOnlyRoots?: string[];
  manifests?: string[];
  readFile?: (absolutePath: string) => Buffer;
  onProgress?: (event: ProjectGraphScanProgress) => void;
  /** Fired for every skipped file/directory, with the reason. */
  onSkip?: (event: ProjectGraphSkipEvent) => void;
}

export interface ProjectGraphScanPlan {
  deepRoots: string[];
  /** sourceRoots the caller asked to deep-scan, before existence filtering. */
  requestedSourceRoots: string[];
  /** Requested sourceRoots that do not exist on disk and were dropped. */
  missingSourceRoots: string[];
  manifestFiles: string[];
  ignoredRoots: string[];
  generatedRoots: string[];
  metadataOnlyRoots: string[];
}

/** Why a file/directory was skipped during the walk. */
export type ProjectGraphSkipReason =
  | 'unreadable-directory'
  | 'stat-failed'
  | 'oversized'
  | 'read-failed';

export interface ProjectGraphSkipEvent {
  path: string;
  reason: ProjectGraphSkipReason;
  /** Present for the `oversized` reason: the file's size in bytes. */
  sizeBytes?: number;
}

export interface ProjectGraphScanProgress {
  phase: 'directory' | 'file' | 'skipped';
  path: string;
  files: number;
  directories: number;
  generatedFiles: number;
  metadataOnlyFiles: number;
  skippedFiles: number;
}

export interface ProjectGraphCacheDiff {
  added: ProjectFileInventoryEntry[];
  changed: ProjectFileInventoryEntry[];
  unchanged: ProjectFileInventoryEntry[];
  deleted: ProjectFileInventoryEntry[];
}

export interface ProjectGraphScanScope {
  filesToScan: number;
  totalBytes: number;
  languages: Record<string, number>;
  ignoredDirectories: string[];
  generatedRoots: string[];
  metadataOnlyRoots: string[];
  warnings: string[];
  llmEnrichment: 'enabled' | 'skipped';
}

export interface ProjectGraphScanScopeOptions extends ScanProjectFilesOptions {
  llmProviderConfigured?: boolean;
}

/**
 * Files larger than this are recorded as skipped instead of being read into
 * memory for hashing/parsing. A code graph gains nothing from multi-MB blobs
 * (vendored bundles, game assets, generated data), and on a large checkout
 * reading every file in full is what exhausts the scanner's heap — the first
 * full index of a 38k-file P4 workspace was OOM-crash-looping under the
 * container memory cap before this guard existed. Override with
 * `MINDSTRATE_SCAN_MAX_FILE_BYTES` (bytes); set to 0 to disable.
 */
const DEFAULT_PROJECT_GRAPH_MAX_FILE_BYTES = 2 * 1024 * 1024;

export const PROJECT_GRAPH_MAX_FILE_BYTES = ((): number => {
  const raw = process.env['MINDSTRATE_SCAN_MAX_FILE_BYTES'];
  if (raw === undefined) return DEFAULT_PROJECT_GRAPH_MAX_FILE_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PROJECT_GRAPH_MAX_FILE_BYTES;
  return parsed; // 0 disables the cap
})();

export const DEFAULT_PROJECT_GRAPH_IGNORES = [
  '.git',
  '.gitignore',
  '.vs',
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

export const estimateProjectGraphScanScope = (
  root: string,
  options: ProjectGraphScanScopeOptions = {},
): ProjectGraphScanScope => {
  const entries = scanProjectFiles(root, options);
  const plan = buildProjectGraphScanPlan(root, options);
  const languages: Record<string, number> = {};
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.size;
    const language = entry.language ?? 'unknown';
    languages[language] = (languages[language] ?? 0) + 1;
  }

  return {
    filesToScan: entries.length,
    totalBytes,
    languages: Object.fromEntries(Object.entries(languages).sort(([left], [right]) => left.localeCompare(right))),
    ignoredDirectories: uniqueSorted([
      ...DEFAULT_PROJECT_GRAPH_IGNORES.filter((pattern) => !pattern.includes('.')),
      ...(options.ignore ?? []),
      ...(options.metadataOnlyRoots ?? []),
    ]),
    generatedRoots: plan.generatedRoots,
    metadataOnlyRoots: plan.metadataOnlyRoots,
    warnings: buildScopeWarnings(entries.length, totalBytes),
    llmEnrichment: options.llmProviderConfigured ? 'enabled' : 'skipped',
  };
};

const buildScopeWarnings = (filesToScan: number, totalBytes: number): string[] => {
  const warnings: string[] = [];
  if (filesToScan > 50000) {
    warnings.push(`Large scan scope: ${filesToScan} files. Mark generated/vendor directories before indexing.`);
  }
  if (totalBytes > 512 * 1024 * 1024) {
    warnings.push(`Large scan size: ${Math.round(totalBytes / 1024 / 1024)} MB. Consider metadata-only or generated roots.`);
  }
  return warnings;
};

export const buildProjectGraphScanPlan = (
  root: string,
  options: ScanProjectFilesOptions = {},
): ProjectGraphScanPlan => {
  const resolvedRoot = path.resolve(root);
  const requestedSourceRoots = uniqueSorted(options.sourceRoots ?? []);
  const sourceRoots = requestedSourceRoots
    .filter((rel) => pathExistsInsideRoot(resolvedRoot, rel));
  const missingSourceRoots = requestedSourceRoots
    .filter((rel) => !sourceRoots.includes(rel));
  return {
    deepRoots: sourceRoots,
    requestedSourceRoots,
    missingSourceRoots,
    manifestFiles: expandManifestFiles(resolvedRoot, options.manifests ?? []),
    ignoredRoots: uniqueSorted([
      ...DEFAULT_PROJECT_GRAPH_IGNORES,
      ...(options.ignore ?? []),
    ]),
    generatedRoots: uniqueSorted(options.generatedRoots ?? []),
    metadataOnlyRoots: uniqueSorted(options.metadataOnlyRoots ?? []),
  };
};

/**
 * Top-level directories under `root` that the scan plan will NOT deep-scan.
 *
 * When `deepRoots` is non-empty the walk only descends into those roots
 * (see {@link scanProjectFiles}), so every other source-bearing top-level
 * directory is silently invisible to the graph. This surfaces them so the
 * caller can warn instead of leaving the user to guess why half the repo is
 * missing. Returns `[]` when nothing is restricted (deepRoots empty = whole
 * tree scanned) or when no readable top-level dirs remain after ignores.
 */
export const findUnscannedTopLevelDirectories = (
  root: string,
  plan: ProjectGraphScanPlan,
  options: ScanProjectFilesOptions = {},
): string[] => {
  if (plan.deepRoots.length === 0) return [];
  const resolvedRoot = path.resolve(root);
  const ignoreRules = loadIgnoreRules(resolvedRoot, options);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const deepTops = new Set(plan.deepRoots.map((rel) => normalizePath(rel).split('/')[0]));
  const unscanned: string[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const rel = normalizePath(dirent.name);
    if (deepTops.has(rel)) continue;
    if (isIgnored(rel, true, ignoreRules)) continue;
    unscanned.push(rel);
  }
  return uniqueSorted(unscanned);
};

export const scanProjectFiles = (
  root: string,
  options: ScanProjectFilesOptions = {},
): ProjectFileInventoryEntry[] => {
  const resolvedRoot = path.resolve(root);
  const ignoreRules = loadIgnoreRules(resolvedRoot, options);
  const plan = buildProjectGraphScanPlan(resolvedRoot, options);
  const entries: ProjectFileInventoryEntry[] = [];
  const seen = new Set<string>();
  const progress: ProjectGraphScanProgress = {
    phase: 'directory',
    path: '',
    files: 0,
    directories: 0,
    generatedFiles: 0,
    metadataOnlyFiles: 0,
    skippedFiles: 0,
  };

  const readFile = options.readFile ?? fs.readFileSync;
  const walkInput = {
    root: resolvedRoot,
    ignoreRules,
    generatedRoots: options.generatedRoots ?? [],
    metadataOnlyRoots: options.metadataOnlyRoots ?? [],
    entries,
    seen,
    readFile,
    progress,
    onProgress: options.onProgress,
    onSkip: options.onSkip,
  };
  for (const relDir of plan.deepRoots.length > 0 ? plan.deepRoots : ['']) {
    walkProject({ ...walkInput, relDir });
  }
  for (const manifest of plan.manifestFiles) {
    addFileEntry({
      root: resolvedRoot,
      rel: manifest,
      generatedRoots: options.generatedRoots ?? [],
      metadataOnlyRoots: options.metadataOnlyRoots ?? [],
      entries,
      seen,
      readFile,
      progress,
      onProgress: options.onProgress,
      onSkip: options.onSkip,
    });
  }
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

interface WalkProjectInput {
  root: string;
  relDir: string;
  ignoreRules: IgnoreRule[];
  generatedRoots: string[];
  metadataOnlyRoots: string[];
  entries: ProjectFileInventoryEntry[];
  seen: Set<string>;
  readFile: (absolutePath: string) => Buffer;
  progress: ProjectGraphScanProgress;
  onProgress?: (event: ProjectGraphScanProgress) => void;
  onSkip?: (event: ProjectGraphSkipEvent) => void;
}

const walkProject = (input: WalkProjectInput): void => {
  const { root, relDir, ignoreRules, generatedRoots, metadataOnlyRoots, entries, seen, readFile, progress, onProgress, onSkip } = input;
  const absDir = path.join(root, relDir);
  progress.directories += 1;
  emitProgress(onProgress, progress, 'directory', relDir || '.');
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    progress.skippedFiles += 1;
    emitProgress(onProgress, progress, 'skipped', relDir || '.');
    onSkip?.({ path: relDir || '.', reason: 'unreadable-directory' });
    return;
  }

  for (const dirent of dirents) {
    const rel = normalizePath(relDir ? path.join(relDir, dirent.name) : dirent.name);
    if (isIgnored(rel, dirent.isDirectory(), ignoreRules)) continue;

    if (dirent.isDirectory()) {
      walkProject({ ...input, relDir: rel });
      continue;
    }
    if (!dirent.isFile()) continue;

    addFileEntry({ root, rel, generatedRoots, metadataOnlyRoots, entries, seen, readFile, progress, onProgress, onSkip });
  }
};

interface AddFileEntryInput {
  root: string;
  rel: string;
  generatedRoots: string[];
  metadataOnlyRoots: string[];
  entries: ProjectFileInventoryEntry[];
  seen: Set<string>;
  readFile: (absolutePath: string) => Buffer;
  progress: ProjectGraphScanProgress;
  onProgress?: (event: ProjectGraphScanProgress) => void;
  onSkip?: (event: ProjectGraphSkipEvent) => void;
}

const addFileEntry = (input: AddFileEntryInput): void => {
  const { root, rel, generatedRoots, metadataOnlyRoots, entries, seen, readFile, progress, onProgress, onSkip } = input;
  const normalizedRel = normalizePath(rel);
  if (seen.has(normalizedRel)) return;
  seen.add(normalizedRel);

  const abs = path.join(root, normalizedRel);
  const stat = statFile(abs);
  if (!stat) {
    progress.skippedFiles += 1;
    emitProgress(onProgress, progress, 'skipped', normalizedRel);
    onSkip?.({ path: normalizedRel, reason: 'stat-failed' });
    return;
  }
  // Skip oversized files before reading them: a full read of a huge blob is
  // the per-file memory spike that OOM-kills the scanner on large checkouts.
  if (PROJECT_GRAPH_MAX_FILE_BYTES > 0 && stat.size > PROJECT_GRAPH_MAX_FILE_BYTES) {
    progress.skippedFiles += 1;
    emitProgress(onProgress, progress, 'skipped', normalizedRel);
    onSkip?.({ path: normalizedRel, reason: 'oversized', sizeBytes: stat.size });
    return;
  }
  const content = readFileContent(abs, readFile);
  if (!content) {
    progress.skippedFiles += 1;
    emitProgress(onProgress, progress, 'skipped', normalizedRel);
    onSkip?.({ path: normalizedRel, reason: 'read-failed' });
    return;
  }
  progress.files += 1;
  if (isUnderAnyRoot(normalizedRel, generatedRoots)) progress.generatedFiles += 1;
  if (isUnderAnyRoot(normalizedRel, metadataOnlyRoots)) progress.metadataOnlyFiles += 1;
  emitProgress(onProgress, progress, 'file', normalizedRel);
  const extension = path.extname(normalizedRel);
  entries.push({
    path: normalizedRel,
    absolutePath: abs,
    size: stat.size,
    extension,
    hash: createHash('sha256').update(content).digest('hex'),
    modifiedTime: stat.mtime.toISOString(),
    language: languageForExtension(extension),
    generated: isUnderAnyRoot(normalizedRel, generatedRoots),
  });
};

const emitProgress = (
  onProgress: ((event: ProjectGraphScanProgress) => void) | undefined,
  progress: ProjectGraphScanProgress,
  phase: ProjectGraphScanProgress['phase'],
  relPath: string,
): void => {
  progress.phase = phase;
  progress.path = relPath;
  onProgress?.({ ...progress });
};

const statFile = (absolutePath: string): fs.Stats | null => {
  try {
    return fs.statSync(absolutePath);
  } catch {
    return null;
  }
};

const readFileContent = (
  absolutePath: string,
  readFile: (absolutePath: string) => Buffer,
): Buffer | null => {
  try {
    return readFile(absolutePath);
  } catch {
    return null;
  }
};

interface IgnoreRule {
  pattern: string;
  directoryOnly: boolean;
}

const loadIgnoreRules = (root: string, options: ScanProjectFilesOptions): IgnoreRule[] => [
  ...DEFAULT_PROJECT_GRAPH_IGNORES.map((pattern) => ({ pattern, directoryOnly: false })),
  ...(options.ignore ?? []).map((pattern) => ({ pattern, directoryOnly: false })),
  ...(options.metadataOnlyRoots ?? []).map((pattern) => ({ pattern, directoryOnly: false })),
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

const pathExistsInsideRoot = (root: string, rel: string): boolean =>
  isSafeRelativePath(rel) && fs.existsSync(path.join(root, rel));

const expandManifestFiles = (root: string, patterns: string[]): string[] =>
  uniqueSorted(patterns.flatMap((pattern) => expandPattern(root, pattern)));

const expandPattern = (root: string, pattern: string): string[] => {
  const normalized = normalizePath(pattern);
  if (!isSafeRelativePath(normalized)) return [];
  if (!normalized.includes('*')) return fs.existsSync(path.join(root, normalized)) ? [normalized] : [];

  const regex = globToRegex(normalized);
  const prefix = fixedGlobPrefix(normalized);
  const start = path.join(root, prefix);
  const out: string[] = [];
  const walk = (dir: string, relBase: string): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const rel = normalizePath(relBase ? path.join(relBase, dirent.name) : dirent.name);
      const abs = path.join(root, rel);
      if (dirent.isDirectory()) walk(abs, rel);
      else if (dirent.isFile() && regex.test(rel)) out.push(rel);
    }
  };
  if (fs.existsSync(start)) walk(start, prefix);
  return out;
};

const fixedGlobPrefix = (pattern: string): string => {
  const wildcard = pattern.search(/[*?]/);
  if (wildcard < 0) return path.dirname(pattern);
  const slash = pattern.slice(0, wildcard).lastIndexOf('/');
  return slash < 0 ? '' : pattern.slice(0, slash);
};

const globToRegex = (pattern: string): RegExp => {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
};

const isSafeRelativePath = (value: string): boolean =>
  !!value && !path.isAbsolute(value) && !normalizePath(value).split('/').includes('..');

export const languageForExtension = (extension: string): string | undefined => {
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
  if (extension === '.py') return 'python';
  if (extension === '.lua') return 'lua';
  return undefined;
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');

const uniqueSorted = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizePath))).sort();
