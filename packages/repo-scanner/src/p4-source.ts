import { execSync } from 'node:child_process';
import type { CommitInfo } from '@mindstrate/server';

export interface P4Env {
  p4Port?: string;
  p4User?: string;
  p4Passwd?: string;
}

function buildEnv(env?: P4Env): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  if (env?.p4Port) merged.P4PORT = env.p4Port;
  if (env?.p4User) merged.P4USER = env.p4User;
  if (env?.p4Passwd) merged.P4PASSWD = env.p4Passwd;
  return merged;
}

export function isP4Available(): boolean {
  try {
    execSync('p4 -V', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

export function isP4Connected(env?: P4Env): boolean {
  try {
    return execSync('p4 info', {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      env: buildEnv(env),
    }).includes('Server address');
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

export function getChangelistInfo(changelist: string, env?: P4Env): CommitInfo | null {
  try {
    const cl = sanitizeChangelist(changelist);
    const processEnv = buildEnv(env);
    const describe = execSync(`p4 describe -s ${cl}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: processEnv,
    });

    const parsed = parseP4Describe(describe);
    if (!parsed) return null;

    let diff = '';
    try {
      diff = extractDiffFromDescribe(execSync(`p4 describe ${cl}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024,
        env: processEnv,
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

export function getRecentChangelists(n: number = 10, depotPath?: string, env?: P4Env): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  try {
    if (depotPath && !/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
      throw new Error(`Invalid depot path format: ${depotPath}`);
    }
    const pathArg = depotPath ? ` ${depotPath}` : '';
    const output = execSync(`p4 changes -s submitted -m ${count}${pathArg}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(env),
    });

    return output
      .split('\n')
      .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

/**
 * Return changelist numbers strictly greater than `cursor`, oldest → newest.
 * Uses `p4 changes ...@<cursor+1>,#head` which is exclusive of the cursor CL.
 */
export function listChangelistsSince(cursor: string, depotPath?: string, env?: P4Env): string[] {
  const cl = sanitizeChangelist(cursor);
  if (depotPath && !/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
    throw new Error(`Invalid depot path format: ${depotPath}`);
  }
  const next = String(BigInt(cl) + 1n);
  const path = depotPath ?? '//...';
  try {
    const output = execSync(`p4 changes -s submitted ${path}@${next},#head`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(env),
    });

    const newestFirst = output
      .split('\n')
      .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
      .filter((value): value is string => Boolean(value));

    return newestFirst.reverse();
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
