/**
 * Project Detection
 *
 * Inspects a directory to identify the project's name, primary language,
 * framework, package manager, dependencies, entry points and a high-level
 * directory layout. Used by `mindstrate init` to build a project snapshot KU and
 * to scope subsequent operations to the right project.
 *
 * Detection is heuristic-based and intentionally pure: no LLM calls here,
 * so it always works offline and is deterministic for the same inputs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { listTopDirs, readGitInfo, readReadmeExcerpt } from './detection-enrichment.js';
import { nodeProjectDetector } from './detectors/node-project-detector.js';
import { pythonProjectDetector } from './detectors/python-project-detector.js';
import { rustProjectDetector } from './detectors/rust-project-detector.js';
import { goProjectDetector } from './detectors/go-project-detector.js';
import type { ProjectDetector } from './detectors/project-detector.js';
import { detectProjectByRules, type ProjectDetectionRuleMatch } from './project-detection-rules.js';
import type { ProjectLayer } from '@mindstrate/protocol/models';

export interface DetectedDependency {
  name: string;
  version: string;
  /** prod | dev | optional */
  kind: 'prod' | 'dev' | 'optional';
}

export interface DetectedProject {
  /** Project name (from manifest > directory name) */
  name: string;
  /** Project root (resolved absolute path) */
  root: string;
  /** Path to the manifest file used (relative to root), if any */
  manifestPath?: string;
  /** Primary language (typescript, javascript, python, rust, go, ...) */
  language?: string;
  /** Detected framework, if any */
  framework?: string;
  /** Build/test runtime if detectable (e.g. "node@18", "python@3.11") */
  runtime?: string;
  /** Package manager */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'go-mod' | string;
  /** Project version (from manifest, if available) */
  version?: string;
  /** Project description / summary */
  description?: string;
  /** Dependency list (truncated when very large) */
  dependencies: DetectedDependency[];
  /** Number of dev dependencies that were truncated */
  truncatedDeps: number;
  /** Detected entry points: bin scripts, main, exports, server.ts, app.py, etc. */
  entryPoints: string[];
  /** npm/pnpm/yarn scripts, or Makefile targets, or pyproject scripts */
  scripts: Record<string, string>;
  /** Top-level directories (depth 1) */
  topDirs: string[];
  /** Notable workspace packages, if monorepo */
  workspaces?: string[];
  /** Git branch + remote (for context only) */
  git?: { branch?: string; remote?: string; isRepo: boolean };
  /** Detection timestamp */
  detectedAt: string;
  /** README.md first paragraph (capped) */
  readmeExcerpt?: string;
  /** Detection rule that matched this project, if any. */
  detectionRule?: ProjectDetectionRuleMatch;
  /** Domain-specific descriptions for top-level directories. */
  topDirDescriptions?: Record<string, string>;
  /** Rule-derived project snapshot guidance. */
  snapshotHints?: {
    overview?: string;
    invariants?: string[];
    conventions?: string[];
  };
  /** Rule-provided project graph routing hints. */
  graphHints?: ProjectGraphHints;
}

export interface ProjectOperationManual {
  architecture?: string[];
  beforeEditWorkflow?: string[];
  criticalInvariants?: string[];
  conventions?: string[];
  moduleResponsibilities?: ProjectModuleResponsibility[];
  flows?: ProjectChangeFlow[];
  playbooks?: ProjectChangePlaybook[];
  validationCommands?: ProjectValidationCommand[];
}

export interface ProjectModuleResponsibility {
  path: string;
  role: string;
  owns?: string[];
  doesNotOwn?: string[];
  runtimeImpact?: string;
  generatedOutputs?: string[];
  editingRules?: string[];
}

export interface ProjectChangeFlow {
  name: string;
  appliesTo?: string[];
  steps: string[];
  validation?: string[];
}

export interface ProjectChangePlaybook {
  changeType: string;
  appliesTo?: string[];
  beforeEdit?: string[];
  edit?: string[];
  verify?: string[];
}

export interface ProjectValidationCommand {
  name: string;
  command?: string;
  appliesTo?: string[];
  note?: string;
}

export interface ProjectGraphHints {
  parserAdapters?: string[];
  queryPacks?: string[];
  conventionExtractors?: string[];
  sourceRoots?: string[];
  generatedRoots?: string[];
  ignore?: string[];
  manifests?: string[];
  riskHints?: string[];
  layers?: ProjectLayer[];
  operationManual?: ProjectOperationManual;
  /**
   * Project-type level recommendations for business-system architecture
   * pages a human or agent should consider authoring under
   * `<project>/.mindstrate/system-pages/`. The detection rule (e.g.
   * `unreal-project.json`) declares these so `mindstrate system-pages
   * list` / `init` can show "this project type usually wants a combat
   * page, an asset-loading page, ..." without forcing them into the
   * graph (game genres differ too much for hardcoded injection).
   */
  suggestedSystemPages?: SuggestedSystemPage[];
  /**
   * Rule-provided **stack architecture pages** that fully replace the
   * generic skeleton for this project type. Loaded from the file named
   * by the rule's `"systemPagesInclude"` field (e.g.
   * `unreal-architecture-pages.json`). The include file is shaped as
   * `{ "en": SystemPageDefinition[], "zh": SystemPageDefinition[] }`.
   *
   * Layering at projection time (low -> high priority):
   *   1. Built-in language-agnostic skeleton (00-overview / 01-entry / ...).
   *   2. `systemPagePresets[locale]` from the matched detection rule
   *      (a Unreal project gets the 8-page architecture book; a plain
   *      Node / Python / Go project does not, and instead keeps the
   *      skeleton).
   *   3. `<project>/.mindstrate/system-pages/*.json` user pages.
   *
   * Same `key` at a higher layer overrides the lower layer entirely.
   */
  systemPagePresets?: Partial<Record<SystemPagePresetLocale, RuleSystemPagePreset[]>>;
}

/** Locales the include-file presets may carry. Mirrors `ProjectGraphLocale`. */
export type SystemPagePresetLocale = 'en' | 'zh';

/**
 * Shape of a single page entry inside a `systemPagesInclude` file. It
 * matches `SystemPageDefinition` but is duplicated here so the project
 * detector layer does not have to depend on the project-graph layer.
 */
export interface RuleSystemPagePreset {
  key: string;
  name: string;
  title: string;
  body: string[];
  overlays: string[];
  userNotesPlaceholder: string;
  userNotesTitle: string;
  overlayTitle: string;
  metadata?: {
    classifications?: string[];
    triggers?: {
      extensions?: string[];
      pathContains?: string[];
      pathSuffix?: string[];
    };
    knownConstraints?: string[];
    doNotEditTargets?: string[];
    affectedChain?: string;
    sourceOfTruth?: string[];
    recommendedVerification?: string[];
    tags?: string[];
  };
}

/**
 * A starter-kit description of one architecture page that this project
 * type typically benefits from. Consumed by the system-pages CLI to:
 *   - report which suggested pages already exist as files under
 *     `.mindstrate/system-pages/` and which are still missing,
 *   - pre-fill the JSON template with classification, source-of-truth,
 *     and verification hints when the user runs
 *     `mindstrate system-pages init <key>` for one of them.
 *
 * Every field is optional except `key`. Values left undefined fall back
 * to the same generic placeholders the empty template uses.
 */
export interface SuggestedSystemPage {
  key: string;
  title?: string;
  body?: string[];
  classifications?: string[];
  knownConstraints?: string[];
  doNotEditTargets?: string[];
  affectedChain?: string;
  sourceOfTruth?: string[];
  recommendedVerification?: string[];
  tags?: string[];
}

const PROJECT_DETECTORS: ProjectDetector[] = [
  nodeProjectDetector,
  pythonProjectDetector,
  rustProjectDetector,
  goProjectDetector,
];

/**
 * Detect a project rooted at `cwd`. Returns null when no project root can be
 * identified (no manifest and not inside a git repo).
 */
export function detectProject(cwd: string = process.cwd()): DetectedProject | null {
  const root = path.resolve(findProjectRoot(cwd) ?? cwd);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;

  const detectedAt = new Date().toISOString();

  const ruleDetected = detectProjectByRules(root);
  const baseDetected = PROJECT_DETECTORS
    .map((detector) => detector.detect(root))
    .find((project): project is DetectedProject => project !== null);
  const detected = ruleDetected
    ? mergeRuleDetection(ruleDetected, baseDetected)
    : baseDetected ?? detectGenericProject(root);
  detected.root = root;
  detected.detectedAt = detectedAt;
  detected.git = readGitInfo(root);
  detected.topDirs = listTopDirs(root);
  detected.readmeExcerpt = readReadmeExcerpt(root);

  return detected;
}

/**
 * Walk upward from `cwd` to find a directory containing any project manifest
 * or a .git folder. Falls back to cwd if nothing is found.
 */
export function findProjectRoot(cwd: string): string | null {
  const markers = [
    'package.json',
    'pyproject.toml',
    'Cargo.toml',
    'go.mod',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'composer.json',
    '.git',
  ];
  let dir = path.resolve(cwd);
  for (let i = 0; i < 25; i++) {
    for (const m of markers) {
      if (fs.existsSync(path.join(dir, m))) return dir;
    }
    if (fs.readdirSync(dir).some((entry) => entry.endsWith('.uproject'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ============================================================
// Generic fallback
// ============================================================

function detectGenericProject(root: string): DetectedProject {
  return {
    name: path.basename(root),
    root,
    dependencies: [],
    truncatedDeps: 0,
    entryPoints: [],
    scripts: {},
    topDirs: [],
    detectedAt: '',
  };
}

const mergeRuleDetection = (
  ruleDetected: DetectedProject,
  baseDetected?: DetectedProject,
): DetectedProject => {
  if (!baseDetected) return ruleDetected;
  return {
    ...baseDetected,
    manifestPath: baseDetected.manifestPath ?? ruleDetected.manifestPath,
    language: ruleDetected.language ?? baseDetected.language,
    framework: ruleDetected.framework ?? baseDetected.framework,
    packageManager: baseDetected.packageManager ?? ruleDetected.packageManager,
    entryPoints: Array.from(new Set([...baseDetected.entryPoints, ...ruleDetected.entryPoints])),
    detectionRule: ruleDetected.detectionRule,
    topDirDescriptions: ruleDetected.topDirDescriptions,
    snapshotHints: ruleDetected.snapshotHints,
    graphHints: ruleDetected.graphHints ?? baseDetected.graphHints,
  };
};

// ============================================================
// Helpers
// ============================================================


