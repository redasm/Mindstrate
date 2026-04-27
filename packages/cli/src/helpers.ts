/**
 * CLI Helper - 创建 Mindstrate 实例
 */

import { Mindstrate, type GraphKnowledgeView } from '@mindstrate/server';

export function createMemory(): Mindstrate {
  return new Mindstrate();
}

/** 格式化日期 */
export function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 截断字符串 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

/** 统一 CLI 错误输出，避免每个命令重复判断 Error 类型 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 知识类型的中文映射 */
export const TYPE_LABELS: Record<string, string> = {
  bug_fix: '错误修复',
  best_practice: '最佳实践',
  architecture: '架构决策',
  convention: '项目约定',
  pattern: '设计模式',
  troubleshooting: '故障排查',
  gotcha: '踩坑记录',
  how_to: '操作指南',
  workflow: '工作流程',
};

/** 状态的中文映射 */
export const STATUS_LABELS: Record<string, string> = {
  probation: '试用期',
  active: '活跃',
  verified: '已验证',
  deprecated: '已废弃',
  outdated: '已过期',
};

/** 根据完整 ID 或部分 ID 前缀查找 ECS 图知识视图 */
export function findGraphKnowledge(memory: Mindstrate, idOrPrefix: string): GraphKnowledgeView | null {
  const entries = memory.readGraphKnowledge({ limit: 100000 });
  return entries.find((entry) => entry.id === idOrPrefix || entry.id.startsWith(idOrPrefix)) ?? null;
}
