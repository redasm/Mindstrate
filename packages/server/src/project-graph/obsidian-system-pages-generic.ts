/**
 * Language-agnostic system page skeleton.
 *
 * Replaces the previous Unreal-flavored built-in defaults
 * (`obsidian-system-pages-en.ts` / `-zh.ts`, removed). Stack-specific
 * architecture pages live in detection rule include files (e.g.
 * `unreal-architecture-pages.json`) and override the matching keys here
 * via `mergeSystemPages`. See `docs/system-pages.md`.
 *
 * Design constraints:
 *   - No framework / language assumptions baked in. Everything is
 *     parameterized off the `DetectedProject` fields (language,
 *     framework, packageManager, entryPoints, scripts, manifestPath,
 *     topDirs, dependencies). A project the detector knows nothing
 *     about still gets a useful skeleton.
 *   - Every page is also internalized into a `RULE + ARCHITECTURE`
 *     node (see `internalize-system-pages.ts`), so the metadata block
 *     is the contract surface for `before-edit` / `impact` reports.
 */

import type { DetectedProject } from '../project/index.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';

interface Labels {
  userNotesPlaceholder: string;
  userNotesTitle: string;
  overlayTitle: string;
  overviewTitleSuffix: string;
  framework: string;
  language: string;
  packageManager: string;
  manifest: string;
  workspaces: string;
  topDirs: string;
  purpose: string;
  purposeBody: string;
  primaryAreas: string;
  editingRule: string;
  editingRuleBody: string;
  entryPointsTitle: string;
  entryPointsEmpty: string;
  scriptsTitle: string;
  scriptsEmpty: string;
  validationTitle: string;
  validationBody: string;
  validationDetected: string;
  validationFallback: string;
  overviewOverlay: string;
  entryOverlay: string;
  validationOverlay: string;
}

const labels: Record<'en' | 'zh', Labels> = {
  en: {
    userNotesPlaceholder: '- Add project-specific confirmations, corrections, or open questions here.',
    userNotesTitle: 'User Notes',
    overlayTitle: 'Structured Overlay',
    overviewTitleSuffix: 'Architecture Overview',
    framework: 'Framework',
    language: 'Primary language',
    packageManager: 'Package manager',
    manifest: 'Manifest',
    workspaces: 'Workspaces',
    topDirs: 'Top-level directories',
    purpose: 'Purpose',
    purposeBody: 'High-value human entry point for the project. Read this before browsing raw graph nodes.',
    primaryAreas: 'Primary Areas',
    editingRule: 'Editing Rule',
    editingRuleBody: 'For non-trivial changes, query `before-edit` and `impact` before editing exact files.',
    entryPointsTitle: 'Entry Points',
    entryPointsEmpty: 'No entry points detected. Confirm with the maintainer or list them under the user notes section.',
    scriptsTitle: 'Scripts',
    scriptsEmpty: 'No scripts detected.',
    validationTitle: 'Validation Playbook',
    validationBody: 'Validation commands must come from the affected chain (build / test / type-check / lint), not from the edited file extension alone.',
    validationDetected: 'Detected validation entrypoints (rerun before merging when relevant):',
    validationFallback: 'No validation script names matched the standard heuristic. Confirm with the maintainer or replace this page with a stack-specific preset.',
    overviewOverlay: '- kind: convention\n  content: Use system architecture pages before raw graph node pages when planning non-trivial edits.',
    entryOverlay: '- kind: convention\n  content: Entry points are the first place to look when tracing a runtime behavior end-to-end.',
    validationOverlay: '- kind: convention\n  content: Validation must reference the affected chain rather than the edited file extension.',
  },
  zh: {
    userNotesPlaceholder: '- 在这里补充项目确认、修正或待确认问题。',
    userNotesTitle: '用户笔记',
    overlayTitle: '结构化 Overlay',
    overviewTitleSuffix: '架构总览',
    framework: '框架',
    language: '主要语言',
    packageManager: '包管理器',
    manifest: 'Manifest',
    workspaces: 'Workspaces',
    topDirs: '顶层目录',
    purpose: '目的',
    purposeBody: '面向人的高价值项目入口。浏览原始图节点前先阅读这里。',
    primaryAreas: '主要区域',
    editingRule: '编辑规则',
    editingRuleBody: '非平凡变更前，先查询 `before-edit` 和 `impact`，再编辑具体文件。',
    entryPointsTitle: '入口点',
    entryPointsEmpty: '未检测到入口点。请与维护者确认或在用户笔记中补充。',
    scriptsTitle: '脚本',
    scriptsEmpty: '未检测到脚本。',
    validationTitle: '验证手册',
    validationBody: '验证命令必须从受影响链路选择（build / test / type-check / lint），不能只根据被编辑文件扩展名决定。',
    validationDetected: '已识别的验证入口（合并前按需重跑）：',
    validationFallback: '未匹配到标准的验证脚本命名。请与维护者确认或替换为一个 stack-specific preset。',
    overviewOverlay: '- kind: convention\n  content: 规划非平凡编辑时，先阅读系统架构页，再查看原始图节点页。',
    entryOverlay: '- kind: convention\n  content: 入口点是端到端追踪运行时行为时的第一站。',
    validationOverlay: '- kind: convention\n  content: 验证必须基于受影响链路，不应只依赖被编辑文件扩展名。',
  },
};

export const genericSystemPageDefinitions = (project: DetectedProject): SystemPageDefinition[] => {
  const t = labels[resolveProjectGraphLocale()];
  return [
    overviewPage(project, t),
    entryAndScriptsPage(project, t),
    validationPlaybookPage(project, t),
  ];
};

const overviewPage = (project: DetectedProject, t: Labels): SystemPageDefinition => ({
  key: '00-overview',
  name: resolveProjectGraphLocale() === 'zh' ? '00-总览.md' : '00-overview.md',
  title: `${project.name} ${t.overviewTitleSuffix}`,
  body: [
    `## ${t.purpose}`,
    '',
    `- ${t.purposeBody}`,
    `- ${t.framework}: ${project.framework ?? 'unknown'}.`,
    `- ${t.language}: ${project.language ?? 'unknown'}.`,
    ...(project.packageManager ? [`- ${t.packageManager}: ${project.packageManager}.`] : []),
    ...(project.manifestPath ? [`- ${t.manifest}: ${project.manifestPath}.`] : []),
    ...(project.workspaces && project.workspaces.length > 0 ? [`- ${t.workspaces}: ${project.workspaces.length}.`] : []),
    '',
    `## ${t.primaryAreas}`,
    '',
    ...renderTopDirs(project),
    '',
    `## ${t.editingRule}`,
    '',
    `- ${t.editingRuleBody}`,
    '',
    '<!-- mindstrate:operation-manual -->',
  ],
  overlays: t.overviewOverlay.split('\n'),
  userNotesPlaceholder: t.userNotesPlaceholder,
  userNotesTitle: t.userNotesTitle,
  overlayTitle: t.overlayTitle,
  metadata: { tags: ['architecture-overview'] },
});

const entryAndScriptsPage = (project: DetectedProject, t: Labels): SystemPageDefinition => {
  const entries = project.entryPoints.slice(0, 20);
  const scripts = Object.entries(project.scripts).slice(0, 30);
  return {
    key: '01-entry-and-scripts',
    name: resolveProjectGraphLocale() === 'zh' ? '01-入口与脚本.md' : '01-entry-and-scripts.md',
    title: t.entryPointsTitle,
    body: [
      `## ${t.entryPointsTitle}`,
      '',
      ...(entries.length > 0
        ? entries.map((entry) => `- \`${entry}\``)
        : [`- ${t.entryPointsEmpty}`]),
      '',
      `## ${t.scriptsTitle}`,
      '',
      ...(scripts.length > 0
        ? scripts.map(([name, command]) => `- \`${name}\`: \`${command}\``)
        : [`- ${t.scriptsEmpty}`]),
    ],
    overlays: t.entryOverlay.split('\n'),
    userNotesPlaceholder: t.userNotesPlaceholder,
    userNotesTitle: t.userNotesTitle,
    overlayTitle: t.overlayTitle,
    metadata: { tags: ['entry-points', 'scripts'] },
  };
};

const validationPlaybookPage = (project: DetectedProject, t: Labels): SystemPageDefinition => {
  const detectedValidationScripts = Object.entries(project.scripts)
    .filter(([name]) => /^(test|build|typecheck|lint|check|verify|ci)/i.test(name));
  return {
    key: '02-validation-playbook',
    name: resolveProjectGraphLocale() === 'zh' ? '02-验证手册.md' : '02-validation-playbook.md',
    title: t.validationTitle,
    body: [
      `## ${t.validationTitle}`,
      '',
      `- ${t.validationBody}`,
      '',
      ...(detectedValidationScripts.length > 0
        ? [
          `### ${t.validationDetected}`,
          '',
          ...detectedValidationScripts.map(([name, command]) => `- \`${name}\`: \`${command}\``),
        ]
        : [`- ${t.validationFallback}`]),
    ],
    overlays: t.validationOverlay.split('\n'),
    userNotesPlaceholder: t.userNotesPlaceholder,
    userNotesTitle: t.userNotesTitle,
    overlayTitle: t.overlayTitle,
    metadata: {
      recommendedVerification: detectedValidationScripts.map(([name]) => `Run \`${name}\` after changes that touch the affected chain.`),
      tags: ['validation', 'playbook'],
    },
  };
};

const renderTopDirs = (project: DetectedProject): string[] => {
  const descriptions = project.topDirDescriptions ?? {};
  const dirs = project.topDirs.length > 0 ? project.topDirs : Object.keys(descriptions);
  if (dirs.length === 0) return ['- (no top-level directories detected)'];
  return dirs.slice(0, 20).map((dir) => {
    const description = descriptions[dir];
    return description ? `- \`${dir}/\`: ${description}` : `- \`${dir}/\``;
  });
};
