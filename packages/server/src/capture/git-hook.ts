/**
 * Mindstrate - Git Hook Integration
 *
 * 提供 git hook 安装/卸载功能，
 * 以及从 git 历史中提取信息的工具函数。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { CommitInfo } from './extractor.js';

/** 获取 git 仓库根目录 */
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

/** 获取最近一次 commit 的信息 */
export function getLastCommit(cwd: string = process.cwd()): CommitInfo | null {
  try {
    const hash = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const message = execSync('git log -1 --format=%B', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const author = execSync('git log -1 --format=%an', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const diff = execSync('git diff HEAD~1..HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const filesStr = execSync('git diff --name-only HEAD~1..HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const files = filesStr.split('\n').filter(Boolean);

    return { hash, message, diff, author, files };
  } catch {
    return null;
  }
}

/** 校验 git hash/ref 是否安全（防止 shell injection） */
function sanitizeRef(ref: string): string {
  // 只允许十六进制字符、~、^、数字（用于 HEAD~1 等合法 git ref）
  if (!/^[a-fA-F0-9~^/.\-_]+$/.test(ref)) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
  return ref;
}

/** 获取指定 commit 的信息 */
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

/** 获取最近 N 次 commit 的 hash 列表 */
export function getRecentCommits(n: number = 10, cwd: string = process.cwd()): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  try {
    const output = execSync(`git log -${count} --format=%H`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================
// Hook installation
// ============================================================

const HOOK_MARKER = '# Mindstrate auto-capture hook';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Automatically capture knowledge from commits
if command -v node >/dev/null 2>&1; then
  node "PLACEHOLDER_CLI_PATH" capture --last-commit --auto 2>/dev/null || true
fi
`;

/** 安装 post-commit hook */
export function installGitHook(cwd: string = process.cwd(), cliPath: string): boolean {
  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) {
    return false;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const hookPath = path.join(hooksDir, 'post-commit');
  const script = HOOK_SCRIPT
    .replace('PLACEHOLDER_CLI_PATH', cliPath.replace(/\\/g, '/'));

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(HOOK_MARKER)) {
      // 已安装，更新
      fs.writeFileSync(hookPath, script, { mode: 0o755 });
      return true;
    }
    // 追加到已有 hook
    fs.appendFileSync(hookPath, '\n' + script);
  } else {
    fs.writeFileSync(hookPath, script, { mode: 0o755 });
  }

  return true;
}

/** 卸载 post-commit hook */
export function uninstallGitHook(cwd: string = process.cwd()): boolean {
  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) return false;

  const hookPath = path.join(gitRoot, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) return true;

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(HOOK_MARKER)) return true;

  // 如果整个文件都是我们的 hook，直接删除
  if (content.trim().startsWith('#!/bin/sh') && content.includes(HOOK_MARKER)) {
    const lines = content.split('\n');
    const markerIdx = lines.findIndex(l => l.includes(HOOK_MARKER));
    if (markerIdx <= 1) {
      fs.unlinkSync(hookPath);
      return true;
    }
  }

  // 否则只移除我们的部分
  const parts = content.split(HOOK_MARKER);
  fs.writeFileSync(hookPath, parts[0].trimEnd() + '\n', { mode: 0o755 });
  return true;
}
