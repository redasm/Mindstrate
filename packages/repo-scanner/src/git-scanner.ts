import { execSync } from 'node:child_process';
import type { CommitInfo } from '@mindstrate/server';

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function getHeadCommit(repoPath: string, branch?: string): string {
  const target = branch ? quote(branch) : 'HEAD';
  return execSync(`git rev-parse ${target}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

export function listCommitsSince(repoPath: string, cursor: string, branch?: string): string[] {
  const target = branch ? quote(branch) : 'HEAD';
  const output = execSync(`git rev-list --reverse ${cursor}..${target}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

export function listRecentCommits(repoPath: string, count: number, branch?: string): string[] {
  const safeCount = Math.max(1, Math.min(count, 100));
  const target = branch ? ` ${quote(branch)}` : '';
  const output = execSync(`git log --reverse -n ${safeCount} --format=%H${target}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

export function readCommit(repoPath: string, hash: string): CommitInfo | null {
  try {
    const safeHash = hash.trim();
    const message = execSync(`git log -1 --format=%B ${safeHash}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const author = execSync(`git log -1 --format=%an ${safeHash}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const filesStr = execSync(`git diff-tree --no-commit-id --name-only -r ${safeHash}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const files = filesStr ? filesStr.split('\n').filter(Boolean) : [];

    let diff = '';
    try {
      diff = execSync(`git diff ${safeHash}~1..${safeHash}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      diff = execSync(`git show --format= --unified=3 ${safeHash}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    return { hash: safeHash, message, diff, author, files };
  } catch {
    return null;
  }
}
