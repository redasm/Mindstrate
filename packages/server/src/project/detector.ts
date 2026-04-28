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
import {
  MAX_DEPS,
  depsFromTomlBlock,
  pickFramework,
  safeJson,
  safeRead,
  scalarFromToml,
} from './detection-support.js';

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
}

/**
 * Detect a project rooted at `cwd`. Returns null when no project root can be
 * identified (no manifest and not inside a git repo).
 */
export function detectProject(cwd: string = process.cwd()): DetectedProject | null {
  const root = path.resolve(findProjectRoot(cwd) ?? cwd);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;

  const detectedAt = new Date().toISOString();

  // Detection order: TS/JS, Python, Rust, Go, generic
  const node = detectNodeProject(root);
  const py = !node ? detectPythonProject(root) : null;
  const rust = !node && !py ? detectRustProject(root) : null;
  const go = !node && !py && !rust ? detectGoProject(root) : null;

  const detected = node ?? py ?? rust ?? go ?? detectGenericProject(root);
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
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ============================================================
// Node / TypeScript / JavaScript
// ============================================================

function detectNodeProject(root: string): DetectedProject | null {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;

  const pkg = safeJson(pkgPath);
  if (!pkg) return null;

  const allDeps: DetectedDependency[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    allDeps.push({ name, version: String(version), kind: 'prod' });
  }
  for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
    allDeps.push({ name, version: String(version), kind: 'dev' });
  }
  for (const [name, version] of Object.entries(pkg.optionalDependencies ?? {})) {
    allDeps.push({ name, version: String(version), kind: 'optional' });
  }

  const language = detectNodeLanguage(root, pkg);
  const framework = pickFramework(allDeps.map((d) => d.name));
  const packageManager = detectNodePackageManager(root, pkg);
  const runtime = detectNodeRuntime(pkg);

  const scripts: Record<string, string> = {};
  for (const [k, v] of Object.entries(pkg.scripts ?? {})) {
    scripts[k] = String(v);
  }

  const entryPoints = collectNodeEntryPoints(root, pkg);
  const workspaces = collectWorkspaces(pkg);

  const truncated = Math.max(0, allDeps.length - MAX_DEPS);
  return {
    name: String(pkg.name ?? path.basename(root)),
    root,
    manifestPath: 'package.json',
    language,
    framework,
    runtime,
    packageManager,
    version: pkg.version ? String(pkg.version) : undefined,
    description: pkg.description ? String(pkg.description) : undefined,
    dependencies: allDeps.slice(0, MAX_DEPS),
    truncatedDeps: truncated,
    entryPoints,
    scripts,
    topDirs: [],
    workspaces,
    detectedAt: '',
  };
}

function detectNodeLanguage(root: string, pkg: any): string {
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) return 'typescript';
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps['typescript'] || deps['@types/node']) return 'typescript';
  return 'javascript';
}

function detectNodePackageManager(root: string, pkg: any): DetectedProject['packageManager'] {
  if (typeof pkg.packageManager === 'string') {
    const pm = pkg.packageManager.split('@')[0];
    if (pm === 'pnpm' || pm === 'yarn' || pm === 'npm') return pm;
  }
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function detectNodeRuntime(pkg: any): string | undefined {
  const engines = pkg.engines;
  if (engines?.node) return `node@${String(engines.node).replace(/^[\^>=~ ]+/, '')}`;
  if (engines?.bun) return `bun@${engines.bun}`;
  if (engines?.deno) return `deno@${engines.deno}`;
  return undefined;
}

function collectNodeEntryPoints(root: string, pkg: any): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.add(v.replace(/^\.\//, ''));
  };
  push(pkg.main);
  push(pkg.module);
  push(pkg.types);
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') push(pkg.bin);
    else for (const v of Object.values(pkg.bin)) push(v);
  }
  if (pkg.exports) {
    walkExports(pkg.exports, push);
  }
  // Common server entries
  for (const cand of ['src/index.ts', 'src/main.ts', 'src/server.ts', 'src/app.ts', 'index.ts', 'index.js']) {
    if (fs.existsSync(path.join(root, cand))) out.add(cand);
  }
  return Array.from(out).slice(0, 12);
}

function walkExports(exp: any, push: (v: unknown) => void): void {
  if (typeof exp === 'string') return push(exp);
  if (exp && typeof exp === 'object') {
    for (const v of Object.values(exp)) walkExports(v, push);
  }
}

function collectWorkspaces(pkg: any): string[] | undefined {
  if (!pkg.workspaces) return undefined;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.slice(0, 20).map(String);
  if (Array.isArray(pkg.workspaces?.packages)) return pkg.workspaces.packages.slice(0, 20).map(String);
  return undefined;
}

// ============================================================
// Python
// ============================================================

function detectPythonProject(root: string): DetectedProject | null {
  const pyproject = path.join(root, 'pyproject.toml');
  const setupPy = path.join(root, 'setup.py');
  const requirements = path.join(root, 'requirements.txt');
  if (!fs.existsSync(pyproject) && !fs.existsSync(setupPy) && !fs.existsSync(requirements)) {
    return null;
  }

  let name = path.basename(root);
  let version: string | undefined;
  let description: string | undefined;
  const deps: DetectedDependency[] = [];
  let manifest: string | undefined;
  let packageManager: DetectedProject['packageManager'] = 'pip';
  let framework: string | undefined;

  if (fs.existsSync(pyproject)) {
    manifest = 'pyproject.toml';
    const text = safeRead(pyproject) ?? '';
    name = scalarFromToml(text, 'name') ?? name;
    version = scalarFromToml(text, 'version');
    description = scalarFromToml(text, 'description');
    if (text.includes('[tool.poetry]')) packageManager = 'poetry';
    else if (text.includes('[tool.pdm]')) packageManager = 'pip';
    // Extract dependencies (very rough; no full TOML parser)
    for (const dep of depsFromTomlBlock(text, 'dependencies')) {
      deps.push({ name: dep, version: '*', kind: 'prod' });
    }
    for (const dep of depsFromTomlBlock(text, 'dev-dependencies')) {
      deps.push({ name: dep, version: '*', kind: 'dev' });
    }
  } else if (fs.existsSync(requirements)) {
    manifest = 'requirements.txt';
    const text = safeRead(requirements) ?? '';
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.replace(/#.*$/, '').trim();
      if (!trimmed) continue;
      const m = trimmed.match(/^([a-zA-Z0-9_.\-]+)\s*([<>=!~]=?\s*[\w.\-]+)?/);
      if (m) deps.push({ name: m[1], version: m[2]?.replace(/\s+/g, '') ?? '*', kind: 'prod' });
    }
  }

  framework = pickFramework(deps.map((d) => d.name));

  const entryPoints: string[] = [];
  for (const cand of ['main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py', 'src/main.py', 'src/app.py']) {
    if (fs.existsSync(path.join(root, cand))) entryPoints.push(cand);
  }

  return {
    name,
    root,
    manifestPath: manifest,
    language: 'python',
    framework,
    runtime: 'python',
    packageManager,
    version,
    description,
    dependencies: deps.slice(0, MAX_DEPS),
    truncatedDeps: Math.max(0, deps.length - MAX_DEPS),
    entryPoints,
    scripts: {},
    topDirs: [],
    detectedAt: '',
  };
}

// ============================================================
// Rust
// ============================================================

function detectRustProject(root: string): DetectedProject | null {
  const cargo = path.join(root, 'Cargo.toml');
  if (!fs.existsSync(cargo)) return null;
  const text = safeRead(cargo) ?? '';
  const name = scalarFromToml(text, 'name') ?? path.basename(root);
  const version = scalarFromToml(text, 'version');
  const description = scalarFromToml(text, 'description');
  const deps: DetectedDependency[] = [];
  for (const dep of depsFromTomlBlock(text, 'dependencies')) {
    deps.push({ name: dep, version: '*', kind: 'prod' });
  }
  for (const dep of depsFromTomlBlock(text, 'dev-dependencies')) {
    deps.push({ name: dep, version: '*', kind: 'dev' });
  }
  const framework = pickFramework(deps.map((d) => d.name));
  const entryPoints: string[] = [];
  for (const cand of ['src/main.rs', 'src/lib.rs']) {
    if (fs.existsSync(path.join(root, cand))) entryPoints.push(cand);
  }
  return {
    name,
    root,
    manifestPath: 'Cargo.toml',
    language: 'rust',
    framework,
    runtime: 'rust',
    packageManager: 'cargo',
    version,
    description,
    dependencies: deps.slice(0, MAX_DEPS),
    truncatedDeps: Math.max(0, deps.length - MAX_DEPS),
    entryPoints,
    scripts: {},
    topDirs: [],
    detectedAt: '',
  };
}

// ============================================================
// Go
// ============================================================

function detectGoProject(root: string): DetectedProject | null {
  const goMod = path.join(root, 'go.mod');
  if (!fs.existsSync(goMod)) return null;
  const text = safeRead(goMod) ?? '';
  const moduleMatch = text.match(/^module\s+(\S+)/m);
  const goVerMatch = text.match(/^go\s+([\d.]+)/m);
  const deps: DetectedDependency[] = [];
  const requireBlock = text.match(/require\s*\(([\s\S]*?)\)/);
  if (requireBlock) {
    for (const line of requireBlock[1].split(/\r?\n/)) {
      const m = line.trim().match(/^(\S+)\s+(\S+)/);
      if (m) deps.push({ name: m[1], version: m[2], kind: 'prod' });
    }
  }
  const framework = pickFramework(deps.map((d) => d.name));
  const entryPoints: string[] = [];
  for (const cand of ['main.go', 'cmd/main.go']) {
    if (fs.existsSync(path.join(root, cand))) entryPoints.push(cand);
  }
  return {
    name: moduleMatch ? path.basename(moduleMatch[1]) : path.basename(root),
    root,
    manifestPath: 'go.mod',
    language: 'go',
    framework,
    runtime: goVerMatch ? `go@${goVerMatch[1]}` : 'go',
    packageManager: 'go-mod',
    version: undefined,
    description: undefined,
    dependencies: deps.slice(0, MAX_DEPS),
    truncatedDeps: Math.max(0, deps.length - MAX_DEPS),
    entryPoints,
    scripts: {},
    topDirs: [],
    detectedAt: '',
  };
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

// ============================================================
// Helpers
// ============================================================


