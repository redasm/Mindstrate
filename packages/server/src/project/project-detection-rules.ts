import * as fs from 'node:fs';
import * as path from 'node:path';
import { ChangeSource, type ProjectLayer } from '@mindstrate/protocol/models';
import type {
  DetectedProject,
  ProjectOperationManual,
  RuleSystemPagePreset,
  SuggestedSystemPage,
  SystemPagePresetLocale,
} from './detector.js';
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
  parserAdapters?: string[];
  queryPacks?: string[];
  conventionExtractors?: string[];
  sourceRoots?: string[];
  generatedRoots?: string[];
  ignore?: string[];
  manifests?: string[];
  riskHints?: string[];
  layers?: RuleProjectLayer[];
  operationManual?: ProjectOperationManual;
  suggestedSystemPages?: SuggestedSystemPage[];
  /**
   * Path (relative to the rule file) of an external preset file that
   * carries the **full architecture pages** for this project type. The
   * file is shaped as `{ "en": RuleSystemPagePreset[], "zh": RuleSystemPagePreset[] }`
   * and gets surfaced via `graphHints.systemPagePresets`. Splitting the
   * pages out keeps detection rules under the AGENTS.md 200-line
   * threshold and lets unrelated rules share the same preset.
   */
  systemPagesInclude?: string;
}

interface RuleProjectLayer {
    id: string;
    label: string;
    roots: string[];
    language?: string;
    parserAdapters: string[];
    queryPacks?: string[];
    conventionExtractors?: string[];
    changeAdapters?: Array<'git' | 'p4' | 'filesystem' | 'manual'>;
    generated?: boolean;
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

  const { rule, source, ruleFilePath } = match;
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
    graphHints: {
      parserAdapters: rule.parserAdapters,
      queryPacks: rule.queryPacks,
      conventionExtractors: rule.conventionExtractors,
      sourceRoots: rule.sourceRoots,
      generatedRoots: rule.generatedRoots,
      ignore: rule.ignore,
      manifests: rule.manifests,
      riskHints: rule.riskHints,
      layers: normalizeLayers(rule.layers),
      operationManual: rule.operationManual,
      suggestedSystemPages: normalizeSuggestedSystemPages(rule.suggestedSystemPages),
      systemPagePresets: loadSystemPagePresets(rule.systemPagesInclude, ruleFilePath),
    },
  };
};

const normalizeSuggestedSystemPages = (
  pages?: SuggestedSystemPage[],
): SuggestedSystemPage[] | undefined => {
  if (!pages || pages.length === 0) return undefined;
  return pages
    .filter((page) => typeof page?.key === 'string' && page.key.length > 0)
    .map((page) => ({ ...page }));
};

const normalizeLayers = (layers?: RuleProjectLayer[]): ProjectLayer[] | undefined =>
  layers?.map((layer) => ({
    ...layer,
    changeAdapters: layer.changeAdapters?.map(toChangeSource),
  }));

const toChangeSource = (source: 'git' | 'p4' | 'filesystem' | 'manual'): ChangeSource => {
  if (source === 'git') return ChangeSource.GIT;
  if (source === 'p4') return ChangeSource.P4;
  if (source === 'filesystem') return ChangeSource.FILESYSTEM;
  return ChangeSource.MANUAL;
};

const loadRules = (root: string): Array<{ rule: ProjectDetectionRule; source: RuleSource; ruleFilePath: string }> => [
  ...loadRulesFromDir(path.join(root, '.mindstrate', 'rules'))
    .map(({ rule, ruleFilePath }) => ({ rule, source: 'project' as const, ruleFilePath })),
  ...loadRulesFromDir(BUILTIN_RULES_DIR)
    .map(({ rule, ruleFilePath }) => ({ rule, source: 'builtin' as const, ruleFilePath })),
];

const loadRulesFromDir = (rulesDir: string): Array<{ rule: ProjectDetectionRule; ruleFilePath: string }> => {
  if (!fs.existsSync(rulesDir)) return [];
  try {
    return fs.readdirSync(rulesDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const ruleFilePath = path.join(rulesDir, name);
        const rule = safeJson(ruleFilePath);
        return rule !== null ? { rule: rule as ProjectDetectionRule, ruleFilePath } : null;
      })
      .filter((entry): entry is { rule: ProjectDetectionRule; ruleFilePath: string } => entry !== null);
  } catch {
    return [];
  }
};

/**
 * Load `{ en: [...], zh: [...] }` from the file pointed to by
 * `systemPagesInclude` (resolved relative to the rule file). Returns
 * `undefined` when the field is missing or the include file is not
 * readable / not shaped correctly. Logging is intentionally silent so
 * detection itself never fails on a malformed preset file — the system
 * pages writer will just fall back to the generic skeleton.
 */
const loadSystemPagePresets = (
  systemPagesInclude: string | undefined,
  ruleFilePath: string,
): Partial<Record<SystemPagePresetLocale, RuleSystemPagePreset[]>> | undefined => {
  if (!systemPagesInclude || typeof systemPagesInclude !== 'string') return undefined;
  // `..` is intentionally allowed: the include file usually sits next to
  // the rule, but a project may legitimately share one preset between
  // multiple rules under the same `rules/` tree.
  const resolved = path.resolve(path.dirname(ruleFilePath), systemPagesInclude);
  const raw = safeJson(resolved);
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const result: Partial<Record<SystemPagePresetLocale, RuleSystemPagePreset[]>> = {};
  for (const locale of ['en', 'zh'] as const) {
    const localeValue = value[locale];
    if (!Array.isArray(localeValue)) continue;
    const parsed = localeValue
      .map(parseRuleSystemPagePreset)
      .filter((entry): entry is RuleSystemPagePreset => entry !== null);
    if (parsed.length > 0) result[locale] = parsed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const parseRuleSystemPagePreset = (raw: unknown): RuleSystemPagePreset | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const key = typeof value['key'] === 'string' ? value['key'] : null;
  const title = typeof value['title'] === 'string' ? value['title'] : null;
  const name = typeof value['name'] === 'string' ? value['name'] : null;
  if (!key || !title || !name) return null;
  const stringArray = (key2: string): string[] => Array.isArray(value[key2])
    ? (value[key2] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    key,
    name,
    title,
    body: stringArray('body'),
    overlays: stringArray('overlays'),
    userNotesPlaceholder: typeof value['userNotesPlaceholder'] === 'string' ? value['userNotesPlaceholder'] : '',
    userNotesTitle: typeof value['userNotesTitle'] === 'string' ? value['userNotesTitle'] : 'User Notes',
    overlayTitle: typeof value['overlayTitle'] === 'string' ? value['overlayTitle'] : 'Structured Overlay',
    metadata: parseRuleSystemPageMetadata(value['metadata']),
  };
};

const parseRuleSystemPageMetadata = (raw: unknown): RuleSystemPagePreset['metadata'] => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const stringArray = (key: string): string[] => Array.isArray(value[key])
    ? (value[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  const result: NonNullable<RuleSystemPagePreset['metadata']> = {};
  if (stringArray('classifications').length > 0) result.classifications = stringArray('classifications');
  const triggers = parseRuleTriggers(value['triggers']);
  if (triggers) result.triggers = triggers;
  if (stringArray('knownConstraints').length > 0) result.knownConstraints = stringArray('knownConstraints');
  if (stringArray('doNotEditTargets').length > 0) result.doNotEditTargets = stringArray('doNotEditTargets');
  if (typeof value['affectedChain'] === 'string') result.affectedChain = value['affectedChain'];
  if (stringArray('sourceOfTruth').length > 0) result.sourceOfTruth = stringArray('sourceOfTruth');
  if (stringArray('recommendedVerification').length > 0) result.recommendedVerification = stringArray('recommendedVerification');
  if (stringArray('tags').length > 0) result.tags = stringArray('tags');
  return Object.keys(result).length > 0 ? result : undefined;
};

const parseRuleTriggers = (raw: unknown): NonNullable<RuleSystemPagePreset['metadata']>['triggers'] => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const stringArray = (key: string): string[] => Array.isArray(value[key])
    ? (value[key] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  const result: NonNullable<NonNullable<RuleSystemPagePreset['metadata']>['triggers']> = {};
  if (stringArray('extensions').length > 0) result.extensions = stringArray('extensions');
  if (stringArray('pathContains').length > 0) result.pathContains = stringArray('pathContains');
  if (stringArray('pathSuffix').length > 0) result.pathSuffix = stringArray('pathSuffix');
  return Object.keys(result).length > 0 ? result : undefined;
};

const isValidRule = (rule: ProjectDetectionRule): boolean =>
  !!rule.id && !!rule.name && !!rule.match && typeof rule.match === 'object';

const compareRuleCandidates = (
  left: { rule: ProjectDetectionRule; source: RuleSource; ruleFilePath: string },
  right: { rule: ProjectDetectionRule; source: RuleSource; ruleFilePath: string },
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
