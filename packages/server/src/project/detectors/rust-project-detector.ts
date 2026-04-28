import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedDependency } from '../detector.js';
import { MAX_DEPS, depsFromTomlBlock, pickFramework, safeRead, scalarFromToml } from '../detection-support.js';
import type { ProjectDetector } from './project-detector.js';

export const rustProjectDetector: ProjectDetector = {
  detect(root) {
    const cargo = path.join(root, 'Cargo.toml');
    if (!fs.existsSync(cargo)) return null;

    const text = safeRead(cargo) ?? '';
    const dependencies = collectRustDependencies(text);

    return {
      name: scalarFromToml(text, 'name') ?? path.basename(root),
      root,
      manifestPath: 'Cargo.toml',
      language: 'rust',
      framework: pickFramework(dependencies.map((dep) => dep.name)),
      runtime: 'rust',
      packageManager: 'cargo',
      version: scalarFromToml(text, 'version'),
      description: scalarFromToml(text, 'description'),
      dependencies: dependencies.slice(0, MAX_DEPS),
      truncatedDeps: Math.max(0, dependencies.length - MAX_DEPS),
      entryPoints: collectRustEntryPoints(root),
      scripts: {},
      topDirs: [],
      detectedAt: '',
    };
  },
};

const collectRustDependencies = (text: string): DetectedDependency[] => [
  ...depsFromTomlBlock(text, 'dependencies').map((name) => ({ name, version: '*', kind: 'prod' as const })),
  ...depsFromTomlBlock(text, 'dev-dependencies').map((name) => ({ name, version: '*', kind: 'dev' as const })),
];

const collectRustEntryPoints = (root: string): string[] => {
  const entryPoints: string[] = [];
  for (const candidate of ['src/main.rs', 'src/lib.rs']) {
    if (fs.existsSync(path.join(root, candidate))) entryPoints.push(candidate);
  }
  return entryPoints;
};

