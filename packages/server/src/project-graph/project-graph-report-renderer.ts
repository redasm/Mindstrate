import type { ProjectGraphOverlay } from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import type { ProjectGraphModule } from './clustering.js';
import { renderProjectGraphOverlayBlock } from './overlay.js';
import type { ProjectGraphReportItem, ProjectGraphStatsExport } from './project-graph-report-types.js';
import { renderProjectOperationManualSections } from './operation-manual.js';
import { resolveProjectGraphLocale, type ProjectGraphLocale } from './project-graph-locale.js';
import {
  listOrFallback,
  overlaySections,
  preserveProjectGraphBlock,
} from './project-graph-report-shared.js';

const text = {
  en: {
    projectGraph: 'Project Graph',
    summary: 'Summary',
    framework: 'Framework',
    language: 'Language',
    nodes: 'Nodes',
    edges: 'Edges',
    entryPoints: 'Entry Points',
    coreModules: 'Core Modules',
    highImpactFiles: 'High Impact Files',
    nativeToScriptBindings: 'Native To Script Bindings',
    assetSurfaces: 'Asset And Blueprint Surfaces',
    generatedAreas: 'Generated Or Do-Not-Edit Areas',
    provenance: 'Provenance',
    inferredSummaries: 'Inferred Summaries',
    openQuestions: 'Open Questions',
    graphNetwork: 'Obsidian Graph Network',
    graphNetworkHint: 'Open the linked node pages to view extracted relationships in Obsidian Graph.',
    suggestedQueries: 'Suggested Graph Queries',
    canonicalFacts: 'Canonical project graph facts live in Mindstrate ECS.',
    repoEditHint: 'This file is a lightweight repository entry point. Edit project graph notes in Obsidian or through Mindstrate overlays; user edits are stored as overlays and do not mutate extracted facts.',
    currentIndex: 'Current Index',
    project: 'Project',
    stats: 'Stats',
    usefulCommands: 'Useful Commands',
    userNotes: 'User Notes',
    userNotesPlaceholder: '- Add architecture notes, confirmations, corrections, or risks here.',
    structuredOverlays: 'Structured Overlays',
    module: 'Module',
    files: 'Files',
    graphNodes: 'Graph Nodes',
    moduleRelations: 'Module Relations',
    moduleNotes: 'Module Notes',
    moduleNotesPlaceholder: '- Add module notes, confirmations, corrections, or risks here.',
    evidence: 'Evidence',
    noneGenerated: '- None generated yet.',
    noneRaised: '- None raised yet.',
    noneDetected: '- None detected yet.',
  },
  zh: {
    projectGraph: '项目关系图',
    summary: '摘要',
    framework: '框架',
    language: '语言',
    nodes: '节点',
    edges: '关系边',
    entryPoints: '入口点',
    coreModules: '核心模块',
    highImpactFiles: '高影响文件',
    nativeToScriptBindings: '原生到脚本绑定',
    assetSurfaces: '资产与蓝图表面',
    generatedAreas: '生成或禁止编辑区域',
    provenance: '来源',
    inferredSummaries: '推断摘要',
    openQuestions: '待确认问题',
    graphNetwork: 'Obsidian 关系网络',
    graphNetworkHint: '打开这些节点页，可在 Obsidian 关系图中查看抽取到的关系。',
    suggestedQueries: '建议的图查询',
    canonicalFacts: '规范项目关系事实保存在 Mindstrate ECS 中。',
    repoEditHint: '此文件是仓库中的轻量入口。请在 Obsidian 或 Mindstrate overlay 中编辑项目图备注；用户编辑会作为 overlay 保存，不会改写抽取事实。',
    currentIndex: '当前索引',
    project: '项目',
    stats: '统计',
    usefulCommands: '常用命令',
    userNotes: '用户备注',
    userNotesPlaceholder: '- 在这里补充架构备注、确认、修正或风险。',
    structuredOverlays: '结构化 Overlay',
    module: '模块',
    files: '文件',
    graphNodes: '图节点',
    moduleRelations: '模块关系',
    moduleNotes: '模块备注',
    moduleNotesPlaceholder: '- 在这里补充模块备注、确认、修正或风险。',
    evidence: '证据',
    noneGenerated: '- 暂未生成。',
    noneRaised: '- 暂无。',
    noneDetected: '- 暂未检测到。',
  },
} satisfies Record<ProjectGraphLocale, Record<string, string>>;

const labels = () => text[resolveProjectGraphLocale()];

export const renderProjectGraphReport = (
  project: DetectedProject,
  stats: ProjectGraphStatsExport,
): string => [
  `# ${labels().projectGraph}: ${project.name}`,
  '',
  `## ${labels().summary}`,
  '',
  `- ${labels().framework}: ${project.framework ?? 'unknown'}`,
  `- ${labels().language}: ${project.language ?? 'unknown'}`,
  `- ${labels().nodes}: ${stats.nodes}`,
  `- ${labels().edges}: ${stats.edges}`,
  '',
  `## ${labels().entryPoints}`,
  '',
  ...reportItemLines(stats.entryPoints),
  '',
  `## ${labels().coreModules}`,
  '',
  ...reportItemLines(stats.coreModules),
  '',
  `## ${labels().highImpactFiles}`,
  '',
  ...reportItemLines(stats.highImpactFiles),
  '',
  `## ${labels().nativeToScriptBindings}`,
  '',
  ...reportItemLines(stats.bindingSurfaces),
  '',
  `## ${labels().assetSurfaces}`,
  '',
  ...reportItemLines(stats.assetSurfaces),
  '',
  `## ${labels().generatedAreas}`,
  '',
  ...listOrFallback(project.graphHints?.generatedRoots ?? []),
  '',
  `## ${labels().provenance}`,
  '',
  ...Object.entries(stats.provenanceCounts).map(([name, count]) => `- ${name}: ${count}`),
  '',
  `## ${labels().inferredSummaries}`,
  '',
  ...inferredSummaryLines(stats.inferredSummaries),
  '',
  `## ${labels().openQuestions}`,
  '',
  ...openQuestionLines(stats.openQuestions),
  '',
  ...renderProjectOperationManualSections(project),
  `## ${labels().graphNetwork}`,
  '',
  `- ${labels().graphNetworkHint}`,
  '- [[nodes/index|Graph node index]]',
  '',
  ...overlaySections(stats.overlays),
  '',
  `## ${labels().suggestedQueries}`,
  '',
  '- mindstrate graph query "entry points"',
  '- mindstrate graph query "high impact files"',
  `- mindstrate graph context ${stats.firstFiles[0] ?? '<file path>'}`,
  '',
].join('\n');

export const renderProjectGraphRepoEntry = (
  project: DetectedProject,
  stats: ProjectGraphStatsExport,
): string => [
  '# PROJECT_GRAPH.md',
  '',
  labels().canonicalFacts,
  '',
  labels().repoEditHint,
  '',
  `## ${labels().currentIndex}`,
  '',
  `- ${labels().project}: ${project.name}`,
  `- ${labels().nodes}: ${stats.nodes}`,
  `- ${labels().edges}: ${stats.edges}`,
  `- ${labels().inferredSummaries}: ${stats.inferredSummaries.length}`,
  `- ${labels().openQuestions}: ${stats.openQuestions.length}`,
  `- ${labels().stats}: .mindstrate/project-graph.json`,
  '',
  `## ${labels().entryPoints}`,
  '',
  ...reportItemLines(stats.entryPoints),
  '',
  `## ${labels().coreModules}`,
  '',
  ...reportItemLines(stats.coreModules),
  '',
  `## ${labels().highImpactFiles}`,
  '',
  ...reportItemLines(stats.highImpactFiles),
  '',
  `## ${labels().nativeToScriptBindings}`,
  '',
  ...reportItemLines(stats.bindingSurfaces),
  '',
  `## ${labels().assetSurfaces}`,
  '',
  ...reportItemLines(stats.assetSurfaces),
  '',
  ...renderProjectOperationManualSections(project),
  ...overlaySections(stats.overlays),
  '',
  `## ${labels().usefulCommands}`,
  '',
  '- mindstrate graph status',
  '- mindstrate graph query "entry points"',
  `- mindstrate graph context ${stats.firstFiles[0] ?? '<file path>'}`,
  '- mindstrate graph sync',
  '',
].join('\n');

export const renderEditableObsidianProjection = (
  generated: string,
  existing: string,
  overlays: ProjectGraphOverlay[],
): string => [
  '<!-- mindstrate:project-graph:generated:start -->',
  generated,
  '<!-- mindstrate:project-graph:generated:end -->',
  '',
  `## ${labels().userNotes}`,
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(existing, 'user-notes') || labels().userNotesPlaceholder,
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  `## ${labels().structuredOverlays}`,
  '',
  renderProjectGraphOverlayBlock(overlays),
  '',
].join('\n');

export const renderEditableModulePage = (
  module: ProjectGraphModule,
  overlays: ProjectGraphOverlay[],
  existing: string,
): string => [
  '<!-- mindstrate:project-graph:module-generated:start -->',
  `# ${labels().module}: ${module.label}`,
  '',
  `## ${labels().files}`,
  '',
  ...listOrFallback(module.files),
  '',
  `## ${labels().graphNodes}`,
  '',
  `- ${module.nodes.length}`,
  '',
  `## ${labels().moduleRelations}`,
  '',
  ...listOrFallback(module.relations.map((relation) => `${relation.kind}: [[modules/${relation.targetSlug}|${relation.targetLabel}]]`)),
  '',
  ...overlaySections(moduleOverlays(module, overlays)),
  '<!-- mindstrate:project-graph:module-generated:end -->',
  '',
  `## ${labels().moduleNotes}`,
  '',
  '<!-- mindstrate:project-graph:module-notes:start -->',
  preserveProjectGraphBlock(existing, 'module-notes') || labels().moduleNotesPlaceholder,
  '<!-- mindstrate:project-graph:module-notes:end -->',
  '',
].join('\n');

const reportItemLines = (items: ProjectGraphReportItem[]): string[] =>
  items.length > 0
    ? items.flatMap((item) => [
      `- ${item.label}`,
      ...(item.impactTags && item.impactTags.length > 0 ? [`  - Tags: ${item.impactTags.join(', ')}`] : []),
      `  - ${labels().evidence}: ${item.evidencePaths.join(', ') || '(none)'}`,
    ])
    : [labels().noneDetected];

const inferredSummaryLines = (summaries: ProjectGraphStatsExport['inferredSummaries']): string[] =>
  summaries.length > 0
    ? summaries.flatMap((summary) => [
      `- ${summary.title} (${summary.provenance})`,
      `  - ${summary.summary}`,
      `  - ${labels().evidence}: ${summary.evidencePaths.join(', ') || '(none)'}`,
    ])
    : [labels().noneGenerated];

const openQuestionLines = (questions: ProjectGraphStatsExport['openQuestions']): string[] =>
  questions.length > 0
    ? questions.flatMap((question) => [
      `- ${question.title}`,
      `  - ${question.summary}`,
      `  - ${labels().evidence}: ${question.evidencePaths.join(', ') || '(none)'}`,
    ])
    : [labels().noneRaised];

const moduleOverlays = (module: ProjectGraphModule, overlays: ProjectGraphOverlay[]): ProjectGraphOverlay[] => {
  const nodeIds = new Set(module.nodes);
  return overlays.filter((overlay) => {
    if (overlay.targetNodeId) return nodeIds.has(overlay.targetNodeId);
    if (!overlay.target) return true;
    if (overlay.target.startsWith('node:')) return nodeIds.has(overlay.target.slice('node:'.length));
    if (overlay.target.startsWith('module:')) return overlay.target.slice('module:'.length) === module.label;
    if (overlay.target.startsWith('path:')) {
      const targetPath = normalizeProjectPath(overlay.target.slice('path:'.length));
      return module.files.some((file) => {
        const moduleFile = normalizeProjectPath(file);
        return moduleFile === targetPath || moduleFile.startsWith(`${targetPath}/`);
      });
    }
    return false;
  });
};

const normalizeProjectPath = (value: string): string => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
