import { execSync } from 'node:child_process';
import * as path from 'node:path';
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

/**
 * Run a p4 command and surface a useful error. execSync only exposes a generic
 * "Command failed" message; the real cause (connect refused, login required,
 * unknown depot, p4 not installed) lives in stderr. We extract it so scan runs
 * record an actionable error instead of silently returning empty results.
 */
function runP4Command(command: string, env?: P4Env, maxBuffer?: number): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(env),
      ...(maxBuffer ? { maxBuffer } : {}),
    });
  } catch (error) {
    throw new Error(`${command} failed: ${describeExecError(error)}`);
  }
}

function describeExecError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { stderr?: unknown; code?: unknown; message?: unknown };
    if (e.code === 'ENOENT') return 'p4 executable not found (install the Perforce CLI)';
    const stderr = typeof e.stderr === 'string'
      ? e.stderr
      : e.stderr instanceof Buffer ? e.stderr.toString('utf-8') : '';
    const trimmed = stderr.trim();
    if (trimmed) return trimmed;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(error);
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
  const cl = sanitizeChangelist(changelist);
  const describe = runP4Command(`p4 describe -s ${cl}`, env);

  const parsed = parseP4Describe(describe);
  if (!parsed) return null;

  let diff = '';
  try {
    diff = extractDiffFromDescribe(runP4Command(`p4 describe ${cl}`, env, 10 * 1024 * 1024));
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
}

export function getRecentChangelists(n: number = 10, depotPath?: string, env?: P4Env): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  validateDepotPath(depotPath);
  const pathArg = depotPath ? ` ${depotPath}` : '';
  const output = runP4Command(`p4 changes -s submitted -m ${count}${pathArg}`, env);
  return output
    .split('\n')
    .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
    .filter((value): value is string => Boolean(value));
}

/**
 * Return changelist numbers strictly greater than `cursor`, oldest → newest.
 * Uses `p4 changes ...@<cursor+1>,#head` which is exclusive of the cursor CL.
 */
export function listChangelistsSince(cursor: string, depotPath?: string, env?: P4Env): string[] {
  const cl = sanitizeChangelist(cursor);
  validateDepotPath(depotPath);
  const next = String(BigInt(cl) + 1n);
  const path = depotPath ?? '//...';
  const output = runP4Command(`p4 changes -s submitted ${path}@${next},#head`, env);
  const newestFirst = output
    .split('\n')
    .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
    .filter((value): value is string => Boolean(value));
  return newestFirst.reverse();
}

export function findP4WorkspaceRoot(depotPath?: string, env?: P4Env): string | null {
  validateDepotPath(depotPath);
  try {
    const pathArg = depotPath ? ` ${depotPath}` : ' //...';
    const output = runP4Command(`p4 -ztag where${pathArg}`, env);
    const localPaths = parseZtagWhereLocalPaths(output);
    if (localPaths.length === 0) return null;
    return commonParent(localPaths);
  } catch {
    return null;
  }
}

/**
 * Parse `p4 -ztag where` output into local paths. Tagged output is used
 * because the plain format separates the three mapping paths with spaces,
 * which truncates local paths that themselves contain spaces (common on
 * Windows). Unmapped entries carry an `... unmap` field and are skipped.
 */
function parseZtagWhereLocalPaths(output: string): string[] {
  const blocks = output.split(/\r?\n\r?\n/);
  const paths: string[] = [];
  for (const block of blocks) {
    if (/^\.\.\. unmap/m.test(block)) continue;
    const match = block.match(/^\.\.\. path (.+)$/m);
    if (match) paths.push(stripP4Wildcard(match[1].trim()));
  }
  return paths;
}

function validateDepotPath(depotPath?: string): void {
  if (depotPath && !/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
    throw new Error(`Invalid depot path format: ${depotPath}`);
  }
}

function stripP4Wildcard(value: string): string {
  return value.replace(/[\\/]?\.\.\.$/, '');
}

function commonParent(paths: string[]): string {
  if (paths.length === 1) return paths[0];
  const resolved = paths.map((entry) => path.resolve(entry));
  let common = resolved[0];
  for (const entry of resolved.slice(1)) {
    while (!isSameOrParent(common, entry)) {
      const parent = path.dirname(common);
      if (parent === common) return parent;
      common = parent;
    }
  }
  return common;
}

function isSameOrParent(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
