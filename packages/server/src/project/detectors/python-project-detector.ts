import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedDependency, DetectedProject } from '../detector.js';
import { MAX_DEPS, depsFromTomlBlock, pickFramework, safeRead, scalarFromToml } from '../detection-support.js';
import type { ProjectDetector } from './project-detector.js';

export const pythonProjectDetector: ProjectDetector = {
  detect(root) {
    const pyproject = path.join(root, 'pyproject.toml');
    const setupPy = path.join(root, 'setup.py');
    const requirements = path.join(root, 'requirements.txt');
    if (!fs.existsSync(pyproject) && !fs.existsSync(setupPy) && !fs.existsSync(requirements)) {
      return null;
    }

    const parsed = fs.existsSync(pyproject)
      ? readPyproject(pyproject, root)
      : readRequirements(requirements, root);
    const entryPoints = collectPythonEntryPoints(root);

    return {
      name: parsed.name,
      root,
      manifestPath: parsed.manifestPath,
      language: 'python',
      framework: pickFramework(parsed.dependencies.map((dep) => dep.name)),
      runtime: 'python',
      packageManager: parsed.packageManager,
      version: parsed.version,
      description: parsed.description,
      dependencies: parsed.dependencies.slice(0, MAX_DEPS),
      truncatedDeps: Math.max(0, parsed.dependencies.length - MAX_DEPS),
      entryPoints,
      scripts: {},
      topDirs: [],
      detectedAt: '',
    };
  },
};

interface ParsedPythonProject {
  name: string;
  manifestPath?: string;
  packageManager: DetectedProject['packageManager'];
  version?: string;
  description?: string;
  dependencies: DetectedDependency[];
}

const readPyproject = (pyproject: string, root: string): ParsedPythonProject => {
  const text = safeRead(pyproject) ?? '';
  const packageManager = text.includes('[tool.poetry]') ? 'poetry' : 'pip';
  return {
    name: scalarFromToml(text, 'name') ?? path.basename(root),
    manifestPath: 'pyproject.toml',
    packageManager,
    version: scalarFromToml(text, 'version'),
    description: scalarFromToml(text, 'description'),
    dependencies: [
      ...depsFromTomlBlock(text, 'dependencies').map((name) => ({ name, version: '*', kind: 'prod' as const })),
      ...depsFromTomlBlock(text, 'dev-dependencies').map((name) => ({ name, version: '*', kind: 'dev' as const })),
    ],
  };
};

const readRequirements = (requirements: string, root: string): ParsedPythonProject => {
  const text = safeRead(requirements) ?? '';
  return {
    name: path.basename(root),
    manifestPath: 'requirements.txt',
    packageManager: 'pip',
    dependencies: text.split(/\r?\n/)
      .map(parseRequirementLine)
      .filter((dep): dep is DetectedDependency => dep !== null),
  };
};

const parseRequirementLine = (line: string): DetectedDependency | null => {
  const trimmed = line.replace(/#.*$/, '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^([a-zA-Z0-9_.\-]+)\s*([<>=!~]=?\s*[\w.\-]+)?/);
  if (!match) return null;

  return {
    name: match[1],
    version: match[2]?.replace(/\s+/g, '') ?? '*',
    kind: 'prod',
  };
};

const collectPythonEntryPoints = (root: string): string[] => {
  const entryPoints: string[] = [];
  for (const candidate of ['main.py', 'app.py', 'manage.py', 'wsgi.py', 'asgi.py', 'src/main.py', 'src/app.py']) {
    if (fs.existsSync(path.join(root, candidate))) entryPoints.push(candidate);
  }
  return entryPoints;
};

