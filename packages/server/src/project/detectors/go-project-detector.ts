import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedDependency } from '../detector.js';
import { MAX_DEPS, pickFramework, safeRead } from '../detection-support.js';
import type { ProjectDetector } from './project-detector.js';

export const goProjectDetector: ProjectDetector = {
  detect(root) {
    const goMod = path.join(root, 'go.mod');
    if (!fs.existsSync(goMod)) return null;

    const text = safeRead(goMod) ?? '';
    const moduleMatch = text.match(/^module\s+(\S+)/m);
    const goVersionMatch = text.match(/^go\s+([\d.]+)/m);
    const dependencies = collectGoDependencies(text);

    return {
      name: moduleMatch ? path.basename(moduleMatch[1]) : path.basename(root),
      root,
      manifestPath: 'go.mod',
      language: 'go',
      framework: pickFramework(dependencies.map((dep) => dep.name)),
      runtime: goVersionMatch ? `go@${goVersionMatch[1]}` : 'go',
      packageManager: 'go-mod',
      dependencies: dependencies.slice(0, MAX_DEPS),
      truncatedDeps: Math.max(0, dependencies.length - MAX_DEPS),
      entryPoints: collectGoEntryPoints(root),
      scripts: {},
      topDirs: [],
      detectedAt: '',
    };
  },
};

const collectGoDependencies = (text: string): DetectedDependency[] => {
  const requireBlock = text.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock) return [];

  return requireBlock[1].split(/\r?\n/)
    .map((line) => line.trim().match(/^(\S+)\s+(\S+)/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({ name: match[1], version: match[2], kind: 'prod' }));
};

const collectGoEntryPoints = (root: string): string[] => {
  const entryPoints: string[] = [];
  for (const candidate of ['main.go', 'cmd/main.go']) {
    if (fs.existsSync(path.join(root, candidate))) entryPoints.push(candidate);
  }
  return entryPoints;
};

