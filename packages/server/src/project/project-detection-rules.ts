import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedProject } from './detector.js';
import { safeJson } from './detection-support.js';

type RuleSource = 'project' | 'builtin';

interface RuleCondition {
  file?: string;
  dir?: string;
  glob?: string;
  readmeContains?: string;
  jsonPath?: string;
  tomlKey?: string;
  packageDependency?: string;
}

interface ProjectDetectionRule {
  id: string;
  name: string;
  priority?: number;
  match: {
    all?: RuleCondition[];
    any?: RuleCondition[];
    none?: RuleCondition[];
  };
  detect?: {
    language?: string;
    framework?: string;
    packageManager?: string;
    manifest?: string;
    entryPoints?: string[];
    topDirs?: Record<string, string>;
  };
  snapshot?: {
    overview?: string;
    invariants?: string[];
    conventions?: string[];
  };
}

export interface ProjectDetectionRuleMatch {
  id: string;
  name: string;
  source: RuleSource;
  priority: number;
}

const BUILTIN_RULES_DIR = path.join(__dirname, 'rules');

export const detectProjectByRules = (root: string): DetectedProject | null => {
  const match = loadRules(root)
    .filter(({ rule }) => isValidRule(rule))
    .filter(({ rule }) => matchesRule(root, rule))
    .sort(compareRuleCandidates)[0];
  if (!match) return null;

  const { rule, source } = match;
  const manifestPath = resolveManifest(root, rule.detect?.manifest);
  return {
    name: manifestPath ? path.basename(manifestPath, path.extname(manifestPath)) : path.basename(root),
    root,
    manifestPath,
    language: rule.detect?.language,
    framework: rule.detect?.framework,
    packageManager: rule.detect?.packageManager,
    dependencies: [],
    truncatedDeps: 0,
    entryPoints: expandEntryPoints(root, rule.detect?.entryPoints ?? []),
    scripts: {},
    topDirs: [],
    detectedAt: '',
    detectionRule: {
      id: rule.id,
      name: rule.name,
      source,
      priority: rule.priority ?? 0,
    },
    topDirDescriptions: rule.detect?.topDirs,
    snapshotHints: rule.snapshot,
  };
};

const loadRules = (root: string): Array<{ rule: ProjectDetectionRule; source: RuleSource }> => [
  ...loadRulesFromDir(path.join(root, '.mindstrate', 'rules')).map((rule) => ({ rule, source: 'project' as const })),
  ...loadRulesFromDir(BUILTIN_RULES_DIR).map((rule) => ({ rule, source: 'builtin' as const })),
];

const loadRulesFromDir = (rulesDir: string): ProjectDetectionRule[] => {
  if (!fs.existsSync(rulesDir)) return [];
  try {
    return fs.readdirSync(rulesDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => safeJson(path.join(rulesDir, name)))
      .filter((rule): rule is ProjectDetectionRule => rule !== null);
  } catch {
    return [];
  }
};

const isValidRule = (rule: ProjectDetectionRule): boolean =>
  !!rule.id && !!rule.name && !!rule.match && typeof rule.match === 'object';

const compareRuleCandidates = (
  left: { rule: ProjectDetectionRule; source: RuleSource },
  right: { rule: ProjectDetectionRule; source: RuleSource },
): number => {
  const priority = (right.rule.priority ?? 0) - (left.rule.priority ?? 0);
  if (priority !== 0) return priority;
  if (left.source === right.source) return 0;
  return left.source === 'project' ? -1 : 1;
};

const matchesRule = (root: string, rule: ProjectDetectionRule): boolean => {
  const all = rule.match.all ?? [];
  const any = rule.match.any ?? [];
  const none = rule.match.none ?? [];
  return all.every((condition) => matchesCondition(root, condition)) &&
    (any.length === 0 || any.some((condition) => matchesCondition(root, condition))) &&
    none.every((condition) => !matchesCondition(root, condition));
};

const matchesCondition = (root: string, condition: RuleCondition): boolean => {
  const checks: boolean[] = [];
  if (condition.file) {
    const abs = resolveInsideRoot(root, condition.file);
    checks.push(abs !== null && fs.existsSync(abs));
  }
  if (condition.dir) {
    const abs = resolveInsideRoot(root, condition.dir);
    checks.push(abs !== null && fs.existsSync(abs) && fs.statSync(abs).isDirectory());
  }
  if (condition.glob) checks.push(expandGlob(root, condition.glob).length > 0);
  if (condition.readmeContains) {
    checks.push(readmeContains(root, condition.readmeContains));
  }
  if (condition.jsonPath) {
    checks.push(jsonPathExists(root, condition.file ?? 'package.json', condition.jsonPath));
  }
  if (condition.tomlKey) {
    checks.push(tomlKeyExists(root, condition.file ?? 'Cargo.toml', condition.tomlKey));
  }
  if (condition.packageDependency) {
    checks.push(packageDependencyExists(root, condition.packageDependency));
  }
  return checks.length > 0 && checks.every(Boolean);
};

const resolveManifest = (root: string, manifest?: string): string | undefined => {
  if (!manifest) return undefined;
  const matches = expandGlob(root, manifest);
  return matches[0] ?? (fs.existsSync(path.join(root, manifest)) ? manifest : undefined);
};

const expandEntryPoints = (root: string, patterns: string[]): string[] =>
  Array.from(new Set(patterns.flatMap((pattern) => expandGlob(root, pattern))))
    .sort();

const expandGlob = (root: string, pattern: string): string[] => {
  if (!isSafeRelativePattern(pattern)) return [];
  if (!pattern.includes('*')) return fs.existsSync(path.join(root, pattern)) ? [normalizePath(pattern)] : [];
  if (!pattern.includes('/')) {
    const regex = globToRegex(pattern);
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && regex.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }
  const regex = globToRegex(pattern);
  return walkFiles(root, fixedGlobPrefix(pattern)).filter((rel) => regex.test(rel));
};

const walkFiles = (root: string, prefix = ''): string[] => {
  const out: string[] = [];
  const ignored = new Set(['node_modules', '.git', '.mindstrate', 'DerivedDataCache', 'Intermediate', 'Saved', 'Binaries']);
  const start = path.join(root, prefix);
  if (!fs.existsSync(start)) return out;
  const walk = (dir: string, relBase: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  try { walk(start, prefix); } catch { /* ignore */ }
  return out;
};

const readmeContains = (root: string, value: string): boolean => {
  const readme = ['README.md', 'README.MD', 'Readme.md', 'readme.md']
    .map((name) => path.join(root, name))
    .find((candidate) => fs.existsSync(candidate));
  return readme ? fs.readFileSync(readme, 'utf8').includes(value) : false;
};

const jsonPathExists = (root: string, file: string, jsonPath: string): boolean => {
  const abs = resolveInsideRoot(root, file);
  if (!abs) return false;
  const data = safeJson(abs);
  if (data === null) return false;
  let current: unknown = data;
  for (const segment of jsonPath.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || !(segment in current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
};

const tomlKeyExists = (root: string, file: string, key: string): boolean => {
  const abs = resolveInsideRoot(root, file);
  if (!abs || !fs.existsSync(abs)) return false;
  const text = fs.readFileSync(abs, 'utf8');
  const parts = key.split('.').filter(Boolean);
  if (parts.length > 1) {
    const field = parts.pop()!;
    const section = parts.join('.');
    let inSection = false;
    for (const line of text.split(/\r?\n/)) {
      const header = line.trim().match(/^\[([^\]]+)\]$/);
      if (header) {
        inSection = header[1] === section;
        continue;
      }
      if (inSection && new RegExp(`^\\s*${escapeRegex(field)}\\s*=`).test(line)) return true;
    }
    return false;
  }
  return new RegExp(`(^|\\n)\\s*${escapeRegex(key)}\\s*=`, 'm').test(text);
};

const packageDependencyExists = (root: string, dependency: string): boolean => {
  const packageJson = safeJson(path.join(root, 'package.json'));
  if (!packageJson || typeof packageJson !== 'object') return false;
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .some((field) => {
      const deps = (packageJson as Record<string, unknown>)[field];
      return !!deps && typeof deps === 'object' && dependency in deps;
    });
};

const resolveInsideRoot = (root: string, rel: string): string | null =>
  isSafeRelativePath(rel) ? path.join(root, rel) : null;

const isSafeRelativePath = (value: string): boolean =>
  !!value && !path.isAbsolute(value) && !normalizePath(value).split('/').includes('..');

const isSafeRelativePattern = (value: string): boolean =>
  !!value && !path.isAbsolute(value) && !normalizePath(value).split('/').includes('..');

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
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizePath = (value: string): string => value.replace(/\\/g, '/');
