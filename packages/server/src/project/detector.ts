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
  };
};

// ============================================================
// Helpers
// ============================================================


