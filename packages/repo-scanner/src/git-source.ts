import { execSync } from 'node:child_process';
import type { CommitInfo } from '@mindstrate/server';

function sanitizeRef(ref: string): string {
  if (!/^[a-fA-F0-9~^/.\-_]+$/.test(ref)) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
  return ref;
}

export function getGitRoot(cwd: string = process.cwd()): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function getLastCommit(cwd: string = process.cwd()): CommitInfo | null {
  try {
    const hash = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return getCommitInfo(hash, cwd);
  } catch {
    return null;
  }
}

export function getCommitInfo(hash: string, cwd: string = process.cwd()): CommitInfo | null {
  try {
    const safeHash = sanitizeRef(hash);
    const fullHash = execSync(`git rev-parse ${safeHash}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const safeFullHash = sanitizeRef(fullHash);
    const message = execSync(`git log -1 --format=%B ${safeFullHash}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const author = execSync(`git log -1 --format=%an ${safeFullHash}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const diff = execSync(`git diff ${safeFullHash}~1..${safeFullHash}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const filesStr = execSync(`git diff --name-only ${safeFullHash}~1..${safeFullHash}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const files = filesStr.split('\n').filter(Boolean);

    return { hash: safeFullHash, message, diff, author, files };
  } catch {
    return null;
  }
}

export function getRecentCommits(n: number = 10, cwd: string = process.cwd()): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  try {
    const output = execSync(`git log -${count} --format=%H`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
