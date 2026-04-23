/**
 * Mindstrate - Perforce (P4) Integration
 *
 * 从 Perforce 提交中提取信息，与 git-hook.ts 对等设计。
 *
 * 前置条件：
 * - p4 命令行工具已安装且在 PATH 中
 * - P4PORT / P4USER / P4CLIENT 等环境变量已配置
 *   或通过 .p4config / p4 set 配置
 */

import { execSync } from 'node:child_process';
import type { CommitInfo } from './extractor.js';

/** 检查 p4 是否可用 */
export function isP4Available(): boolean {
  try {
    execSync('p4 -V', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** 检查 p4 连接是否正常 */
export function isP4Connected(): boolean {
  try {
    const output = execSync('p4 info', { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
    // 如果输出包含 "Server address" 说明连接正常
    return output.includes('Server address');
  } catch {
    return false;
  }
}

/** 校验 changelist 号是否合法（纯数字） */
function sanitizeChangelist(cl: string): string {
  const num = cl.trim();
  if (!/^\d+$/.test(num)) {
    throw new Error(`Invalid changelist number: ${num}`);
  }
  return num;
}

/**
 * 获取指定 changelist 的详细信息
 *
 * 将 P4 changelist 转换为与 git CommitInfo 兼容的结构，
 * 这样可以复用 KnowledgeExtractor 来提取知识。
 */
export function getChangelistInfo(changelist: string): CommitInfo | null {
  try {
    const cl = sanitizeChangelist(changelist);

    // p4 describe -s <changelist> 获取提交信息（-s 不输出 diff 内容）
    const describe = execSync(`p4 describe -s ${cl}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 解析 p4 describe 输出
    const parsed = parseP4Describe(describe);
    if (!parsed) return null;

    // 获取 diff（p4 diff2 比较变更前后）
    let diff = '';
    try {
      // p4 describe（不带 -s）包含 diff
      const fullDescribe = execSync(`p4 describe ${cl}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        maxBuffer: 10 * 1024 * 1024, // 10MB，P4 diff 可能很大
      });
      diff = extractDiffFromDescribe(fullDescribe);
    } catch {
      // diff 获取失败不影响主流程
    }

    return {
      hash: `p4@${cl}`,           // 用 p4@changelist 作为唯一标识
      message: parsed.description,
      diff,
      author: parsed.user,
      files: parsed.files,
    };
  } catch {
    return null;
  }
}

/**
 * 获取最近 N 个已提交的 changelist 号
 *
 * @param n - 数量
 * @param path - P4 depot 路径过滤（如 //depot/project/...），默认当前 client 全部
 */
export function getRecentChangelists(n: number = 10, depotPath?: string): string[] {
  const count = Math.max(1, Math.min(Math.floor(n) || 10, 1000));
  try {
    // depotPath 安全验证：只允许 P4 depot 路径格式
    if (depotPath && !/^\/\/[a-zA-Z0-9_.\-\/]+$/.test(depotPath)) {
      throw new Error(`Invalid depot path format: ${depotPath}`);
    }
    const pathArg = depotPath ? ` ${depotPath}` : '';
    const output = execSync(`p4 changes -s submitted -m ${count}${pathArg}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 输出格式：Change 12345 on 2024/01/15 by user@client 'description...'
    const cls: string[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^Change\s+(\d+)\s+on/);
      if (match) {
        cls.push(match[1]);
      }
    }
    return cls;
  } catch {
    return [];
  }
}

/**
 * 获取当前用户最近的 pending changelist
 */
export function getPendingChangelists(): string[] {
  try {
    // 获取当前 P4 用户
    let p4user = '';
    try {
      const info = execSync('p4 info', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const userMatch = info.match(/User name:\s*(\S+)/);
      if (userMatch) p4user = userMatch[1];
    } catch { /* ignore */ }

    if (!p4user) return [];

    // Sanitize p4user to prevent shell injection
    if (!/^[\w.\-@]+$/.test(p4user)) return [];

    const output = execSync(`p4 changes -s pending -u ${p4user}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const cls: string[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/^Change\s+(\d+)\s+on/);
      if (match) {
        cls.push(match[1]);
      }
    }
    return cls;
  } catch {
    return [];
  }
}

// ============================================================
// Parsing helpers
// ============================================================

interface P4DescribeResult {
  changelist: string;
  user: string;
  description: string;
  files: string[];
}

/**
 * 解析 `p4 describe -s` 输出
 *
 * 格式示例：
 * ```
 * Change 12345 by user@client on 2024/01/15 12:30:00
 *
 *   Fix rendering issue in player HUD
 *   - Updated shader to handle alpha correctly
 *
 * Affected files ...
 *
 * ... //depot/project/Source/HUD.cpp#3 edit
 * ... //depot/project/Source/Shader.usf#2 edit
 * ```
 */
function parseP4Describe(output: string): P4DescribeResult | null {
  const lines = output.split('\n');

  // 第一行：Change <num> by <user>@<client> on <date>
  const headerMatch = lines[0]?.match(/^Change\s+(\d+)\s+by\s+([^@]+)@/);
  if (!headerMatch) return null;

  const changelist = headerMatch[1];
  const user = headerMatch[2];

  // 描述：从第二行开始，到 "Affected files" 或 "... //" 之前
  const descLines: string[] = [];
  const fileLines: string[] = [];
  let inFiles = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('Affected files') || line.match(/^\.\.\.\s+\/\//)) {
      inFiles = true;
    }

    if (inFiles) {
      // 文件行：... //depot/path/file.ext#rev action
      const fileMatch = line.match(/^\.\.\.\s+(\/\/[^#]+)/);
      if (fileMatch) {
        // 提取 depot 路径，去掉 //depot/ 前缀使其更可读
        const filePath = fileMatch[1].replace(/^\/\/[^/]+\//, '');
        fileLines.push(filePath);
      }
    } else {
      // 描述行（去掉前导 tab/空格）
      const trimmed = line.replace(/^\t/, '');
      if (trimmed || descLines.length > 0) {
        descLines.push(trimmed);
      }
    }
  }

  return {
    changelist,
    user,
    description: descLines.join('\n').trim(),
    files: fileLines,
  };
}

/**
 * 从 `p4 describe`（完整输出，含 diff）中提取 diff 部分
 */
function extractDiffFromDescribe(output: string): string {
  // diff 通常在 "Differences ..." 行之后
  const diffMarker = output.indexOf('Differences ...');
  if (diffMarker === -1) {
    // 有些版本用不同的格式，尝试找 "==== " 行
    const eqMarker = output.indexOf('==== ');
    if (eqMarker === -1) return '';
    return output.substring(eqMarker);
  }
  return output.substring(diffMarker);
}
