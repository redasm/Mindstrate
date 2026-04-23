import { execSync } from 'node:child_process';
import type { CommitInfo } from '@mindstrate/server';

export function isP4Available(): boolean {
  try {
    execSync('p4 -V', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function isP4Connected(): boolean {
  try {
    return execSync('p4 info', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' }).includes('Server address');
  } catch {
    return false;
  }
}

function sanitizeChangelist(cl: string): string {
  const num = cl.trim();
  if (!/^\d+$/.test(num)) {
    throw new Error(`Invalid changelist number: ${num}`);
  }
  return num;
}

export function getChangelistInfo(changelist: string): CommitInfo | null {
  try {
    const cl = sanitizeChangelist(changelist);
    const describe = execSync(`p4 describe -s ${cl}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const parsed = parseP4Describe(describe);
    if (!parsed) return null;

    let diff = '';
    try {
      diff = extractDiffFromDescribe(execSync(`p4 describe ${cl}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch {
      diff = '';
    }

    return {
      hash: `p4@${cl}`,
      message: parsed.description,
      diff,
      author: parsed.user,
      files: parsed.files,
    };
  } catch {
    return null;
  }
}

export function getRecentChangelists(n: number = 10, depotPath?: string): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  try {
    if (depotPath && !/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
      throw new Error(`Invalid depot path format: ${depotPath}`);
    }
    const pathArg = depotPath ? ` ${depotPath}` : '';
    const output = execSync(`p4 changes -s submitted -m ${count}${pathArg}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return output
      .split('\n')
      .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

interface P4DescribeResult {
  user: string;
  description: string;
  files: string[];
}

function parseP4Describe(output: string): P4DescribeResult | null {
  const lines = output.split('\n');
  const headerMatch = lines[0]?.match(/^Change\s+(\d+)\s+by\s+([^@]+)@/);
  if (!headerMatch) return null;

  const user = headerMatch[2];
  const descLines: string[] = [];
  const files: string[] = [];
  let inFiles = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Affected files') || line.match(/^\.\.\.\s+\/\//)) {
      inFiles = true;
    }

    if (inFiles) {
      const fileMatch = line.match(/^\.\.\.\s+(\/\/[^#]+)/);
      if (fileMatch) {
        files.push(fileMatch[1].replace(/^\/\/[^/]+\//, ''));
      }
      continue;
    }

    const trimmed = line.replace(/^\t/, '');
    if (trimmed || descLines.length > 0) {
      descLines.push(trimmed);
    }
  }

  return {
    user,
    description: descLines.join('\n').trim(),
    files,
  };
}

function extractDiffFromDescribe(output: string): string {
  const diffMarker = output.indexOf('Differences ...');
  if (diffMarker >= 0) return output.substring(diffMarker);

  const eqMarker = output.indexOf('==== ');
  return eqMarker >= 0 ? output.substring(eqMarker) : '';
}
