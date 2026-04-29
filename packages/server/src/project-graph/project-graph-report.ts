import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextDomainType, ProjectionTarget } from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';

export interface ProjectGraphArtifactResult {
  reportPath: string;
  statsPath: string;
  nodes: number;
  edges: number;
}

export interface ProjectGraphStatsExport {
  project: string;
  generatedAt: string;
  nodes: number;
  edges: number;
  projectionNodeId?: string;
  firstFiles: string[];
  provenanceCounts: Record<string, number>;
  nodeKindCounts: Record<string, number>;
}

export const writeProjectGraphArtifacts = (
  store: ContextGraphStore,
  project: DetectedProject,
): ProjectGraphArtifactResult => {
  const stats = collectProjectGraphStats(store, project);
  const report = renderProjectGraphRepoEntry(project, stats);
  const reportPath = path.join(project.root, 'PROJECT_GRAPH.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');

  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');
  fs.writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  if (stats.projectionNodeId) {
    store.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY}:${project.name}`,
      nodeId: stats.projectionNodeId,
      target: ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
      targetRef: reportPath,
      version: 1,
      projectedAt: stats.generatedAt,
    });
  }

  return {
    reportPath,
    statsPath,
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
): ProjectGraphArtifactResult => {
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const projectSlug = slugify(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const report = renderEditableObsidianProjection(generated, existing);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');
  fs.writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  if (stats.projectionNodeId) {
    store.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_OBSIDIAN}:${project.name}`,
      nodeId: stats.projectionNodeId,
      target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
      targetRef: reportPath,
      version: 1,
      projectedAt: stats.generatedAt,
    });
  }

  return {
    reportPath,
    statsPath,
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

export const collectProjectGraphStats = (
  store: ContextGraphStore,
  project: DetectedProject,
): ProjectGraphStatsExport => {
  const nodes = store.listNodes({
    project: project.name,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: 100000,
  }).filter((node) => node.metadata?.['projectGraph'] === true);
  const edges = store.listEdges({ limit: 100000 })
    .filter((edge) => edge.evidence?.['projectGraph'] === true);
  const firstFiles = nodes
    .filter((node) => node.metadata?.['kind'] === 'file')
    .map((node) => node.title)
    .sort()
    .slice(0, 12);

  return {
    project: project.name,
    generatedAt: new Date().toISOString(),
    nodes: nodes.length,
    edges: edges.length,
    projectionNodeId: nodes[0]?.id,
    firstFiles,
    provenanceCounts: countBy(nodes, (node) => String(node.metadata?.['provenance'] ?? 'unknown')),
    nodeKindCounts: countBy(nodes, (node) => String(node.metadata?.['kind'] ?? 'unknown')),
  };
};

const renderProjectGraphReport = (
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
  '## First Files To Read',
  '',
  ...listOrFallback(stats.firstFiles),
  '',
  '## Generated Or Do-Not-Edit Areas',
  '',
  ...listOrFallback(project.graphHints?.generatedRoots ?? []),
  '',
  '## Provenance',
  '',
  ...Object.entries(stats.provenanceCounts).map(([name, count]) => `- ${name}: ${count}`),
  '',
  '## Suggested Graph Queries',
  '',
  '- mindstrate graph query "entry points"',
  '- mindstrate graph query "high impact files"',
  '- mindstrate graph context src/App.tsx',
  '',
].join('\n');

const renderProjectGraphRepoEntry = (
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
  `- Stats: .mindstrate/project-graph.json`,
  '',
  '## Useful Commands',
  '',
  '- mindstrate graph status',
  '- mindstrate graph query "entry points"',
  '- mindstrate graph context <node id>',
  '- mindstrate graph sync',
  '',
].join('\n');

const listOrFallback = (items: string[]): string[] =>
  items.length > 0 ? items.map((item) => `- ${item}`) : ['- None detected yet.'];

const renderEditableObsidianProjection = (generated: string, existing: string): string => [
  '<!-- mindstrate:project-graph:generated:start -->',
  generated,
  '<!-- mindstrate:project-graph:generated:end -->',
  '',
  '## User Notes',
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveBlock(existing, 'user-notes') || '- Add architecture notes, confirmations, corrections, or risks here.',
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
].join('\n');

const preserveBlock = (text: string, name: string): string => {
  const start = `<!-- mindstrate:project-graph:${name}:start -->`;
  const end = `<!-- mindstrate:project-graph:${name}:end -->`;
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return '';
  return text.slice(startIndex + start.length, endIndex).trim();
};

const slugify = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

const countBy = <T>(items: T[], keyFor: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};
