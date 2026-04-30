import type { ProjectGraphOverlay } from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import type { ProjectGraphModule } from './clustering.js';
import { renderProjectGraphOverlayBlock } from './overlay.js';
import type { ProjectGraphReportItem, ProjectGraphStatsExport } from './project-graph-report-types.js';
import {
  listOrFallback,
  overlaySections,
  preserveProjectGraphBlock,
} from './project-graph-report-shared.js';

export const renderProjectGraphReport = (
  project: DetectedProject,
  stats: ProjectGraphStatsExport,
): string => [
  `# Project Graph: ${project.name}`,
  '',
  '## Summary',
  '',
  `- Framework: ${project.framework ?? 'unknown'}`,
  `- Language: ${project.language ?? 'unknown'}`,
  `- Nodes: ${stats.nodes}`,
  `- Edges: ${stats.edges}`,
  '',
  '## Entry Points',
  '',
  ...reportItemLines(stats.entryPoints),
  '',
  '## Core Modules',
  '',
  ...reportItemLines(stats.coreModules),
  '',
  '## High Impact Files',
  '',
  ...listOrFallback(stats.firstFiles),
  '',
  '## Native To Script Bindings',
  '',
  ...reportItemLines(stats.bindingSurfaces),
  '',
  '## Asset And Blueprint Surfaces',
  '',
  ...reportItemLines(stats.assetSurfaces),
  '',
  '## Generated Or Do-Not-Edit Areas',
  '',
  ...listOrFallback(project.graphHints?.generatedRoots ?? []),
  '',
  '## Provenance',
  '',
  ...Object.entries(stats.provenanceCounts).map(([name, count]) => `- ${name}: ${count}`),
  '',
  '## Inferred Summaries',
  '',
  ...inferredSummaryLines(stats.inferredSummaries),
  '',
  '## Open Questions',
  '',
  ...openQuestionLines(stats.openQuestions),
  '',
  ...overlaySections(stats.overlays),
  '',
  '## Suggested Graph Queries',
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
  'Canonical project graph facts live in Mindstrate ECS.',
  '',
  'This file is a lightweight repository entry point. Edit project graph notes in Obsidian or through Mindstrate overlays; user edits are stored as overlays and do not mutate extracted facts.',
  '',
  '## Current Index',
  '',
  `- Project: ${project.name}`,
  `- Nodes: ${stats.nodes}`,
  `- Edges: ${stats.edges}`,
  `- Inferred summaries: ${stats.inferredSummaries.length}`,
  `- Open questions: ${stats.openQuestions.length}`,
  `- Stats: .mindstrate/project-graph.json`,
  '',
  '## Entry Points',
  '',
  ...reportItemLines(stats.entryPoints),
  '',
  '## Core Modules',
  '',
  ...reportItemLines(stats.coreModules),
  '',
  '## Native To Script Bindings',
  '',
  ...reportItemLines(stats.bindingSurfaces),
  '',
  '## Asset And Blueprint Surfaces',
  '',
  ...reportItemLines(stats.assetSurfaces),
  '',
  ...overlaySections(stats.overlays),
  '',
  '## Useful Commands',
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
  '## User Notes',
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(existing, 'user-notes') || '- Add architecture notes, confirmations, corrections, or risks here.',
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  '## Structured Overlays',
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
  `# Module: ${module.label}`,
  '',
  '## Files',
  '',
  ...listOrFallback(module.files),
  '',
  `## Graph Nodes`,
  '',
  `- ${module.nodes.length}`,
  '',
  ...overlaySections(moduleOverlays(module, overlays)),
  '<!-- mindstrate:project-graph:module-generated:end -->',
  '',
  '## Module Notes',
  '',
  '<!-- mindstrate:project-graph:module-notes:start -->',
  preserveProjectGraphBlock(existing, 'module-notes') || '- Add module notes, confirmations, corrections, or risks here.',
  '<!-- mindstrate:project-graph:module-notes:end -->',
  '',
].join('\n');

const reportItemLines = (items: ProjectGraphReportItem[]): string[] =>
  items.length > 0
    ? items.flatMap((item) => [
      `- ${item.label}`,
      `  - Evidence: ${item.evidencePaths.join(', ') || '(none)'}`,
    ])
    : ['- None detected yet.'];

const inferredSummaryLines = (summaries: ProjectGraphStatsExport['inferredSummaries']): string[] =>
  summaries.length > 0
    ? summaries.flatMap((summary) => [
      `- ${summary.title} (${summary.provenance})`,
      `  - ${summary.summary}`,
      `  - Evidence: ${summary.evidencePaths.join(', ') || '(none)'}`,
    ])
    : ['- None generated yet.'];

const openQuestionLines = (questions: ProjectGraphStatsExport['openQuestions']): string[] =>
  questions.length > 0
    ? questions.flatMap((question) => [
      `- ${question.title}`,
      `  - ${question.summary}`,
      `  - Evidence: ${question.evidencePaths.join(', ') || '(none)'}`,
    ])
    : ['- None raised yet.'];

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
