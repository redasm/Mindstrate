import * as fs from 'node:fs';
import * as path from 'node:path';
import { getGitRoot } from './git-source.js';

const HOOK_MARKER = '# Mindstrate external scan hook';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Automatically scan the latest commit through mindstrate-scan
if command -v node >/dev/null 2>&1; then
  node "PLACEHOLDER_CLI_PATH" ingest git --last-commit --auto 2>/dev/null || true
fi
`;

export function installGitHook(cwd: string = process.cwd(), cliPath: string): boolean {
  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) return false;

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = path.join(hooksDir, 'post-commit');
  const script = HOOK_SCRIPT.replace('PLACEHOLDER_CLI_PATH', cliPath.replace(/\\/g, '/'));

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(HOOK_MARKER)) {
      fs.writeFileSync(hookPath, script, { mode: 0o755 });
      return true;
    }
    fs.appendFileSync(hookPath, '\n' + script);
    return true;
  }

  fs.writeFileSync(hookPath, script, { mode: 0o755 });
  return true;
}

export function uninstallGitHook(cwd: string = process.cwd()): boolean {
  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) return false;

  const hookPath = path.join(gitRoot, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) return true;

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(HOOK_MARKER)) return true;

  if (content.trim().startsWith('#!/bin/sh')) {
    const lines = content.split('\n');
    const markerIdx = lines.findIndex((line) => line.includes(HOOK_MARKER));
    if (markerIdx <= 1) {
      fs.unlinkSync(hookPath);
      return true;
    }
  }

  const parts = content.split(HOOK_MARKER);
  fs.writeFileSync(hookPath, parts[0].trimEnd() + '\n', { mode: 0o755 });
  return true;
}
