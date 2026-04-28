import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedDependency, DetectedProject } from '../detector.js';
import { MAX_DEPS, pickFramework, safeJson } from '../detection-support.js';
import type { ProjectDetector } from './project-detector.js';

export const nodeProjectDetector: ProjectDetector = {
  detect(root) {
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = safeJson(pkgPath);
    if (!pkg) return null;

    const allDeps = collectNodeDependencies(pkg);
    const scripts = collectScripts(pkg);
    const truncatedDeps = Math.max(0, allDeps.length - MAX_DEPS);

    return {
      name: String(pkg.name ?? path.basename(root)),
      root,
      manifestPath: 'package.json',
      language: detectNodeLanguage(root, pkg),
      framework: pickFramework(allDeps.map((dep) => dep.name)),
      runtime: detectNodeRuntime(pkg),
      packageManager: detectNodePackageManager(root, pkg),
      version: pkg.version ? String(pkg.version) : undefined,
      description: pkg.description ? String(pkg.description) : undefined,
      dependencies: allDeps.slice(0, MAX_DEPS),
      truncatedDeps,
      entryPoints: collectNodeEntryPoints(root, pkg),
      scripts,
      topDirs: [],
      workspaces: collectWorkspaces(pkg),
      detectedAt: '',
    };
  },
};

const collectNodeDependencies = (pkg: any): DetectedDependency[] => [
  ...Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
    kind: 'prod' as const,
  })),
  ...Object.entries(pkg.devDependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
    kind: 'dev' as const,
  })),
  ...Object.entries(pkg.optionalDependencies ?? {}).map(([name, version]) => ({
    name,
    version: String(version),
    kind: 'optional' as const,
  })),
];

const collectScripts = (pkg: any): Record<string, string> => Object.fromEntries(
  Object.entries(pkg.scripts ?? {}).map(([key, value]) => [key, String(value)]),
);

const detectNodeLanguage = (root: string, pkg: any): string => {
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) return 'typescript';
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps['typescript'] || deps['@types/node']) return 'typescript';
  return 'javascript';
};

const detectNodePackageManager = (root: string, pkg: any): DetectedProject['packageManager'] => {
  if (typeof pkg.packageManager === 'string') {
    const packageManager = pkg.packageManager.split('@')[0];
    if (packageManager === 'pnpm' || packageManager === 'yarn' || packageManager === 'npm') {
      return packageManager;
    }
  }
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'npm';
};

const detectNodeRuntime = (pkg: any): string | undefined => {
  const engines = pkg.engines;
  if (engines?.node) return `node@${String(engines.node).replace(/^[\^>=~ ]+/, '')}`;
  if (engines?.bun) return `bun@${engines.bun}`;
  if (engines?.deno) return `deno@${engines.deno}`;
  return undefined;
};

const collectNodeEntryPoints = (root: string, pkg: any): string[] => {
  const out = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.add(value.replace(/^\.\//, ''));
  };

  push(pkg.main);
  push(pkg.module);
  push(pkg.types);
  if (pkg.bin) {
    if (typeof pkg.bin === 'string') push(pkg.bin);
    else Object.values(pkg.bin).forEach(push);
  }
  if (pkg.exports) {
    walkExports(pkg.exports, push);
  }

  for (const candidate of ['src/index.ts', 'src/main.ts', 'src/server.ts', 'src/app.ts', 'index.ts', 'index.js']) {
    if (fs.existsSync(path.join(root, candidate))) out.add(candidate);
  }

  return Array.from(out).slice(0, 12);
};

const walkExports = (exportsValue: any, push: (value: unknown) => void): void => {
  if (typeof exportsValue === 'string') {
    push(exportsValue);
    return;
  }
  if (!exportsValue || typeof exportsValue !== 'object') return;
  Object.values(exportsValue).forEach((value) => walkExports(value, push));
};

const collectWorkspaces = (pkg: any): string[] | undefined => {
  if (!pkg.workspaces) return undefined;
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.slice(0, 20).map(String);
  if (Array.isArray(pkg.workspaces?.packages)) return pkg.workspaces.packages.slice(0, 20).map(String);
  return undefined;
};

