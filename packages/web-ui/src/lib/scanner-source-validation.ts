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

export function validateGitSource(input: GitSourceValidationInput): void {
  if (input.repoPath) {
    validateDirectory(input.repoPath, 'Git repo path');
    validateGitRepository(input.repoPath);
  }
  if (input.remoteUrl && commandExists('git')) {
    validateGitRemote(input.remoteUrl, input.authToken);
  }
}

export function validateP4Source(input: P4SourceValidationInput): void {
  validateDepotPath(input.depotPath);
  if (input.repoPath) {
    validateDirectory(input.repoPath, 'P4 workspace path');
  }

  // Live P4 probing requires the Perforce CLI. The web-ui container does not
  // ship p4 (scanning runs in the repo-scanner container), so when p4 is
  // absent we skip connectivity checks rather than blocking source creation.
  if (!commandExists('p4')) return;

  if (!input.repoPath) {
    runP4(['where', input.depotPath], input);
  }
  runP4(['changes', '-s', 'submitted', '-m', '1', input.depotPath], input);
}

function validateDirectory(value: string, label: string): void {
  if (!fs.existsSync(value)) {
    throw new Error(`${label} does not exist: ${value}`);
  }
  if (!fs.statSync(value).isDirectory()) {
    throw new Error(`${label} is not a directory: ${value}`);
  }
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
