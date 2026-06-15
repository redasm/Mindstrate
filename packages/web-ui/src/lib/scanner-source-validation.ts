import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const COMMAND_TIMEOUT_MS = 15_000;

export interface GitSourceValidationInput {
  repoPath?: string;
  remoteUrl?: string;
  authToken?: string;
}

export interface P4SourceValidationInput {
  repoPath?: string;
  depotPath: string;
  p4Port?: string;
  p4User?: string;
  p4Passwd?: string;
}

/** Throws on locally provable misconfiguration; returns warnings for what only the scanner runtime can verify. */
export function validateGitSource(input: GitSourceValidationInput): string[] {
  const warnings: string[] = [];
  if (input.repoPath && directoryVisibleLocally(input.repoPath, 'Git repo path', warnings)) {
    validateGitRepository(input.repoPath);
  }
  if (input.remoteUrl && commandExists('git')) {
    validateGitRemote(input.remoteUrl, input.authToken);
  }
  return warnings;
}

/** Throws on locally provable misconfiguration; returns warnings for what only the scanner runtime can verify. */
export function validateP4Source(input: P4SourceValidationInput): string[] {
  const warnings: string[] = [];
  validateDepotPath(input.depotPath);
  validateP4Port(input.p4Port);
  if (input.repoPath) {
    directoryVisibleLocally(input.repoPath, 'P4 workspace path', warnings);
  }

  // Live P4 probing requires the Perforce CLI. The web-ui container does not
  // ship p4 (scanning runs in the repo-scanner container), so when p4 is
  // absent we skip connectivity checks rather than blocking source creation.
  if (!commandExists('p4')) return warnings;

  if (!input.repoPath) {
    runP4(['where', input.depotPath], input);
  }
  runP4(['changes', '-s', 'submitted', '-m', '1', input.depotPath], input);
  return warnings;
}

/**
 * The configured path is consumed by the repo-scanner process, whose
 * filesystem is not necessarily this one — web-ui commonly runs in its own
 * container while the scanner runs on the host or in a sibling container.
 * A path this process cannot see is therefore only a warning (the scanner
 * validates it for real on the first run); a path that exists here but is
 * not a directory is provably wrong and still fails hard.
 */
function directoryVisibleLocally(value: string, label: string, warnings: string[]): boolean {
  if (!fs.existsSync(value)) {
    warnings.push(
      `${label} is not visible from the web-ui process: ${value}. `
      + 'If the scanner daemon runs on another host or container, make sure the path exists there; '
      + 'it will be validated on the first scan run.',
    );
    return false;
  }
  if (!fs.statSync(value).isDirectory()) {
    throw new Error(`${label} is not a directory: ${value}`);
  }
  return true;
}

function validateGitRepository(repoPath: string): void {
  if (!commandExists('git')) return;
  const insideWorkTree = runGit(['-C', repoPath, 'rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree.trim() === 'true') return;

  const bare = runGit(['-C', repoPath, 'rev-parse', '--is-bare-repository']);
  if (bare.trim() !== 'true') {
    throw new Error(`Git repo path is not a repository: ${repoPath}`);
  }
}

function validateGitRemote(remoteUrl: string, authToken?: string): void {
  const args = authToken
    ? ['-c', `http.extraheader=Authorization: Bearer ${authToken}`, 'ls-remote', '--heads', remoteUrl]
    : ['ls-remote', '--heads', remoteUrl];
  runGit(args);
}

function runGit(args: string[]): string {
  return runCommand('git', args, { GIT_TERMINAL_PROMPT: '0' });
}

function runP4(args: string[], input: P4SourceValidationInput): string {
  return runCommand('p4', args, {
    ...(input.p4Port ? { P4PORT: input.p4Port } : {}),
    ...(input.p4User ? { P4USER: input.p4User } : {}),
    ...(input.p4Passwd ? { P4PASSWD: input.p4Passwd } : {}),
  });
}

function commandExists(command: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    execFileSync(probe, [command], { stdio: ['pipe', 'pipe', 'pipe'], timeout: COMMAND_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[], envPatch: Record<string, string> = {}): string {
  try {
    return execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT_MS,
      env: { ...process.env, ...envPatch },
    });
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error);
    throw new Error(`${command} validation failed: ${message}`);
  }
}

function validateDepotPath(depotPath: string): void {
  if (!/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
    throw new Error(`Invalid depot path format: ${depotPath}`);
  }
}

/**
 * P4PORT must be `[protocol:]host:port` with no slashes. Users routinely paste
 * the depot-path style `//host:port` or a URL style `ssl://host:port`, which
 * makes p4 read `//host` as the hostname and fail at scan time with "Name or
 * service not known". Reject it here so the mistake surfaces on save, not three
 * minutes into a scan.
 */
function validateP4Port(p4Port?: string): void {
  if (!p4Port) return;
  const value = p4Port.trim();
  if (/\s/.test(value)) {
    throw new Error(`Invalid P4 port: "${p4Port}" must not contain whitespace`);
  }
  if (value.includes('/')) {
    throw new Error(
      `Invalid P4 port: "${p4Port}". Use host:port or ssl:host:port (no slashes); `
      + '"/" is for depot paths. Example: p4.example.com:1666',
    );
  }
}
