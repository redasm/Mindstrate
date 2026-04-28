import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DetectedProject } from './detector.js';
import { README_EXCERPT_MAX, safeRead } from './detection-support.js';

export const readGitInfo = (root: string): DetectedProject['git'] => {
  if (!fs.existsSync(path.join(root, '.git'))) {
    return { isRepo: false };
  }
  let branch: string | undefined;
  let remote: string | undefined;
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* ignore */ }
  try {
    remote = execSync('git config --get remote.origin.url', {
      cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* ignore */ }
  return { isRepo: true, branch, remote };
};

export const listTopDirs = (root: string): string[] => {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => (
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        !['node_modules', 'dist', 'build', 'target', '__pycache__'].includes(entry.name)
      ))
      .map((entry) => entry.name)
      .slice(0, 30)
      .sort();
  } catch {
    return [];
  }
};

export const readReadmeExcerpt = (root: string): string | undefined => {
  const candidates = ['README.md', 'README.MD', 'Readme.md', 'readme.md'];
  for (const name of candidates) {
    const filePath = path.join(root, name);
    if (fs.existsSync(filePath)) {
      const text = safeRead(filePath);
      if (!text) return undefined;
      const stripped = text.replace(/^#.*$/m, '').trim();
      const paragraph = stripped.split(/\n\s*\n/)[0]?.trim();
      if (!paragraph) return undefined;
      return paragraph.length > README_EXCERPT_MAX
        ? `${paragraph.slice(0, README_EXCERPT_MAX)}...`
        : paragraph;
    }
  }
  return undefined;
};
