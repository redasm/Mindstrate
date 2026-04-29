/**
 * Chinese display labels for CLI output (knowledge types, node statuses,
 * date formatting). Kept separate from runtime concerns so localization
 * additions don't churn lifecycle code.
 */

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

export const STATUS_LABELS: Record<string, string> = {
  probation: '试用期',
  active: '活跃',
  verified: '已验证',
  outdated: '已过期',
};

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
