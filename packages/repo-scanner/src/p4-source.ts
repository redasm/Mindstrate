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

// A Perforce ticket is a 32-char hex string. A configured secret that already
// looks like one is passed straight through as P4PASSWD; anything else is
// treated as a plaintext password that must be exchanged for a ticket.
const P4_TICKET_RE = /^[0-9a-fA-F]{32}$/;

// Process-scoped ticket cache so a scan (which issues many p4 commands —
// `changes` plus a `describe` per changelist) logs in once, not per command.
// Keyed by port+user and refreshed on auth failure, so a long-running daemon
// survives ticket expiry mid-run.
const p4TicketCache = new Map<string, string>();
const credKey = (env?: P4Env): string => `${env?.p4Port ?? ''}|${env?.p4User ?? ''}`;

const isAuthError = (message: string): boolean =>
  /(password|p4passwd|login|ticket|session|expired)/i.test(message);

function execP4(command: string, env?: P4Env, maxBuffer?: number): string {
  return execSync(command, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: buildEnv(env),
    ...(maxBuffer ? { maxBuffer } : {}),
  });
}

/**
 * Exchange the configured plaintext password for a Perforce ticket via
 * `p4 login -p`, which prints the ticket instead of writing the ticket file —
 * so it doesn't depend on P4TICKETS being writable/persistent in a container.
 * Servers at security level >= 2 reject a plaintext P4PASSWD for commands like
 * `p4 changes`, so the scanner must mint a ticket and pass THAT as P4PASSWD.
 */
function mintP4Ticket(env: P4Env, force: boolean): string {
  const key = credKey(env);
  if (!force) {
    const cached = p4TicketCache.get(key);
    if (cached) return cached;
  }
  let out: string;
  try {
    out = execSync('p4 login -p', {
      input: `${env.p4Passwd ?? ''}\n`,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildEnv(env),
    });
  } catch (error) {
    throw new Error(`p4 login failed: ${describeExecError(error)}`);
  }
  const ticket = out.match(/[0-9a-fA-F]{32}/)?.[0];
  if (!ticket) {
    throw new Error('p4 login -p returned no ticket; check the configured P4 password');
  }
  p4TicketCache.set(key, ticket);
  return ticket;
}

// Prefer a cached ticket on the first attempt when we have one; otherwise run
// with the configured secret as-is (a ticket, or a plaintext password that a
// low-security server still accepts).
function firstAttemptEnv(env?: P4Env): P4Env | undefined {
  if (!env?.p4Passwd || P4_TICKET_RE.test(env.p4Passwd)) return env;
  const cached = p4TicketCache.get(credKey(env));
  return cached ? { ...env, p4Passwd: cached } : env;
}

/**
 * Run a p4 command and surface a useful error. execSync only exposes a generic
 * "Command failed" message; the real cause (connect refused, login required,
 * unknown depot, p4 not installed) lives in stderr. We extract it so scan runs
 * record an actionable error instead of silently returning empty results.
 *
 * On a ticket-level server the configured plaintext password is rejected; when
 * that happens we transparently `p4 login` to mint a ticket and retry once.
 */
function runP4Command(command: string, env?: P4Env, maxBuffer?: number): string {
  try {
    return execP4(command, firstAttemptEnv(env), maxBuffer);
  } catch (error) {
    const message = describeExecError(error);
    if (env?.p4Passwd && !P4_TICKET_RE.test(env.p4Passwd) && isAuthError(message)) {
      const ticket = mintP4Ticket(env, true);
      try {
        return execP4(command, { ...env, p4Passwd: ticket }, maxBuffer);
      } catch (retryError) {
        throw new Error(`${command} failed: ${describeExecError(retryError)}`);
      }
    }
    throw new Error(`${command} failed: ${message}`);
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
  const normalized = depotPathForChanges(depotPath);
  const pathArg = normalized ? ` ${normalized}` : '';
  const output = runP4Command(`p4 changes -s submitted -m ${count}${pathArg}`, env);
  return output
    .split('\n')
    .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
    .filter((value): value is string => Boolean(value));
}

/**
 * `p4 changes //depot/dir` treats the trailing segment as a *file* spec and
 * matches nothing for a directory — the silent "0 changelists" that leaves the
 * knowledge base empty. Append the `...` wildcard so a depot path configured as
 * a plain directory lists the changes under that subtree. Paths that already
 * carry a wildcard (`...` or `*`) are left untouched.
 */
function depotPathForChanges(depotPath?: string): string | undefined {
  if (!depotPath) return undefined;
  const trimmed = depotPath.trim();
  if (trimmed.endsWith('...') || trimmed.includes('*')) return trimmed;
  return trimmed.endsWith('/') ? `${trimmed}...` : `${trimmed}/...`;
}

/**
 * Return changelist numbers strictly greater than `cursor`, oldest → newest.
 * Uses `p4 changes ...@<cursor+1>,#head` which is exclusive of the cursor CL.
 */
export function listChangelistsSince(cursor: string, depotPath?: string, env?: P4Env): string[] {
  const cl = sanitizeChangelist(cursor);
  validateDepotPath(depotPath);
  const next = String(BigInt(cl) + 1n);
  const depot = depotPathForChanges(depotPath) ?? '//...';
  const output = runP4Command(`p4 changes -s submitted ${depot}@${next},#head`, env);
  const newestFirst = output
    .split('\n')
    .map((line) => line.match(/^Change\s+(\d+)\s+on/)?.[1])
    .filter((value): value is string => Boolean(value));
  return newestFirst.reverse();
}

export function findP4WorkspaceRoot(depotPath?: string, env?: P4Env): string | null {
  validateDepotPath(depotPath);
  try {
    const normalized = depotPathForChanges(depotPath);
    const pathArg = normalized ? ` ${normalized}` : ' //...';
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
  // `p4 where` reports local paths in the p4 *client's* OS style, which is not
  // necessarily the host running the scanner (a Linux scanner can index a
  // Windows workspace's paths). Pick the matching path flavor from the path
  // itself instead of `node:path`, whose behavior follows the host OS — on a
  // POSIX host `path.resolve('C:\\work')` is treated as relative and collapses
  // the common parent down to cwd.
  const p = pathFlavor(paths[0]);
  const resolved = paths.map((entry) => p.resolve(entry));
  let common = resolved[0];
  for (const entry of resolved.slice(1)) {
    while (!isSameOrParent(p, common, entry)) {
      const parent = p.dirname(common);
      if (parent === common) return parent;
      common = parent;
    }
  }
  return common;
}

function pathFlavor(sample: string): typeof path.win32 {
  // Windows local paths are drive-letter (C:\...) or UNC (\\server\share\...).
  if (/^[a-zA-Z]:[\\/]/.test(sample) || sample.startsWith('\\\\')) return path.win32;
  return path.posix;
}

function isSameOrParent(p: typeof path.win32, parent: string, child: string): boolean {
  const relative = p.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !p.isAbsolute(relative));
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
