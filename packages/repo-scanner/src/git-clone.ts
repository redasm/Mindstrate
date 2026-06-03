import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScanSource } from '@mindstrate/server';

const REPOS_ROOT = process.env['REPO_SCANNER_REPOS_DIR'] ?? '/repos';

export function autoClonePath(sourceId: string): string {
  return path.join(REPOS_ROOT, sourceId);
}

export function ensureGitClone(source: ScanSource): string {
  if (!source.remoteUrl) {
    if (!source.repoPath) throw new Error(`Git source ${source.id} has no repoPath`);
    return source.repoPath;
  }

  const targetPath = source.repoPath ?? autoClonePath(source.id);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  const headerArg = source.authToken
    ? ` -c http.extraheader=${shellQuote(`Authorization: Bearer ${source.authToken}`)}`
    : '';

  if (!fs.existsSync(path.join(targetPath, '.git')) && !fs.existsSync(path.join(targetPath, 'HEAD'))) {
    execSync(`git${headerArg} clone --mirror ${shellQuote(source.remoteUrl)} ${shellQuote(targetPath)}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return targetPath;
  }

  execSync(`git${headerArg} -C ${shellQuote(targetPath)} fetch --prune`, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return targetPath;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
