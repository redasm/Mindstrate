import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  ProjectionTarget,
  isProjectGraphEdge,
  isProjectGraphNode,
  type EvidenceRef,
  type ContextNode,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphModules, type ProjectGraphModule } from './clustering.js';
import {
  createProjectGraphOverlay,
  listProjectGraphOverlays,
  parseProjectGraphOverlayBlock,
  renderProjectGraphOverlayBlock,
} from './overlay.js';

export interface ProjectGraphArtifactResult {
  reportPath: string;
  statsPath: string;
  graphPath: string;
  modulePaths: string[];
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
  entryPoints: ProjectGraphReportItem[];
  coreModules: ProjectGraphReportItem[];
  assetSurfaces: ProjectGraphReportItem[];
  bindingSurfaces: ProjectGraphReportItem[];
  overlays: ProjectGraphOverlay[];
  inferredSummaries: Array<{
    title: string;
    summary: string;
    provenance: string;
    evidencePaths: string[];
  }>;
  openQuestions: Array<{
    title: string;
    summary: string;
    evidencePaths: string[];
  }>;
  provenanceCounts: Record<string, number>;
  nodeKindCounts: Record<string, number>;
}

export interface ProjectGraphReportItem {
  label: string;
  evidencePaths: string[];
}

export const writeProjectGraphArtifacts = (
  store: ContextGraphStore,
  project: DetectedProject,
): ProjectGraphArtifactResult => {
  const stats = collectProjectGraphStats(store, project);
  const report = renderProjectGraphRepoEntry(project, stats);
  const reportPath = path.join(project.root, 'PROJECT_GRAPH.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const graph = collectProjectGraphArtifact(store, project, stats);

  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
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
    graphPath,
    modulePaths: [],
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
): ProjectGraphArtifactResult => {
  const projectSlug = slugify(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  importOverlayBlock(store, project.name, existing);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
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
    graphPath,
    modulePaths,
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

export const collectProjectGraphArtifact = (
  store: ContextGraphStore,
  project: DetectedProject,
  stats: ProjectGraphStatsExport = collectProjectGraphStats(store, project),
): ProjectGraphArtifact => {
  const nodes = store.listNodes({
    project: project.name,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }).filter(isProjectGraphNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = store.listEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter(isProjectGraphEdge)
    .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId));

  return {
    schemaVersion: 1,
    project: project.name,
    generatedAt: stats.generatedAt,
    scan: {
      root: project.root,
      framework: project.framework,
      language: project.language,
    },
    nodes: nodes
      .map((node) => toArtifactNode(node, stats.overlays))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges
      .map(toArtifactEdge)
      .sort((left, right) => left.id.localeCompare(right.id)),
    overlays: listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT }),
    stats: {
      nodes: stats.nodes,
      edges: stats.edges,
      provenanceCounts: stats.provenanceCounts,
      nodeKindCounts: stats.nodeKindCounts,
    },
  };
};

export const collectProjectGraphStats = (
  store: ContextGraphStore,
  project: DetectedProject,
): ProjectGraphStatsExport => {
  const nodes = store.listNodes({
    project: project.name,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  }).filter(isProjectGraphNode);
  const edges = store.listEdges({ limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter(isProjectGraphEdge);
  const firstFiles = nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'file')
    .filter((node) => node.metadata?.['generated'] !== true)
    .map((node) => node.title)
    .sort((left, right) => scoreFirstFile(right) - scoreFirstFile(left) || left.localeCompare(right))
    .slice(0, 12);
  const entryPoints = firstFiles.slice(0, 8).map((label) => ({ label, evidencePaths: [label] }));
  const coreModules = nodes
    .filter((node) => ['project', 'directory', 'file'].includes(String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? '')))
    .map((node) => ({ label: node.title, evidencePaths: evidencePathsForNode(node), score: scoreFirstFile(node.title) }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, 8)
    .map(({ label, evidencePaths }) => ({ label, evidencePaths }));
  const assetSurfaces = nodes
    .filter((node) => node.metadata?.['scanMode'] === 'metadata-only' && typeof node.metadata?.['assetClass'] === 'string')
    .map((node) => ({ label: `${node.title} (${node.metadata?.['assetClass']})`, evidencePaths: evidencePathsForNode(node) }))
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, 8);
  const bindingSurfaces = nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'dependency')
    .map((node) => ({ label: node.title, evidencePaths: evidencePathsForNode(node) }))
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, 8);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });

  return {
    project: project.name,
    generatedAt: new Date().toISOString(),
    nodes: nodes.length,
    edges: edges.length,
    projectionNodeId: nodes[0]?.id,
    firstFiles,
    entryPoints,
    coreModules,
    assetSurfaces,
    bindingSurfaces,
    overlays,
    inferredSummaries: nodes
      .filter((node) => {
        const provenance = String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? '');
        return provenance === 'INFERRED';
      })
      .map((node) => ({
        title: node.title,
        summary: typeof node.metadata?.['summary'] === 'string' ? node.metadata['summary'] : node.content,
        provenance: String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown'),
        evidencePaths: evidencePathsForNode(node),
      }))
      .slice(0, 12),
    openQuestions: nodes
      .filter((node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? '') === 'AMBIGUOUS')
      .map((node) => ({
        title: node.title,
        summary: typeof node.metadata?.['summary'] === 'string' ? node.metadata['summary'] : node.content,
        evidencePaths: evidencePathsForNode(node),
      }))
      .slice(0, 12),
    provenanceCounts: countBy(nodes, (node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown')),
    nodeKindCounts: countBy(nodes, (node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown')),
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

const listOrFallback = (items: string[]): string[] =>
  items.length > 0 ? items.map((item) => `- ${item}`) : ['- None detected yet.'];

const reportItemLines = (items: ProjectGraphReportItem[]): string[] =>
  items.length > 0
    ? items.flatMap((item) => [
      `- ${item.label}`,
      `  - Evidence: ${item.evidencePaths.join(', ') || '(none)'}`,
    ])
    : ['- None detected yet.'];

const scoreFirstFile = (filePath: string): number => {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  let score = 0;
  if (normalized.includes('/index.')) score += 60;
  if (normalized.includes('/main.')) score += 55;
  if (normalized.includes('/app.')) score += 50;
  if (normalized.startsWith('src/')) score += 40;
  if (normalized.endsWith('package.json') || normalized.endsWith('.uproject') || normalized.endsWith('.uplugin')) score += 30;
  if (normalized.endsWith('.build.cs') || normalized.endsWith('.target.cs')) score += 25;
  if (normalized.endsWith('readme.md')) score -= 20;
  return score;
};

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

const renderEditableObsidianProjection = (
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
  preserveBlock(existing, 'user-notes') || '- Add architecture notes, confirmations, corrections, or risks here.',
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  '## Structured Overlays',
  '',
  renderProjectGraphOverlayBlock(overlays),
  '',
].join('\n');

const importOverlayBlock = (
  store: ContextGraphStore,
  project: string,
  text: string,
): void => {
  const parsed = parseProjectGraphOverlayBlock(text);
  if (parsed.length === 0) return;
  const existing = listProjectGraphOverlays(store, { project, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  for (const overlay of parsed) {
    const alreadyStored = existing.some((entry) =>
      entry.kind === overlay.kind
      && entry.content === overlay.content
      && entry.targetNodeId === overlay.targetNodeId
      && entry.targetEdgeId === overlay.targetEdgeId);
    if (alreadyStored) continue;
    createProjectGraphOverlay(store, {
      project,
      targetNodeId: overlay.targetNodeId,
      targetEdgeId: overlay.targetEdgeId,
      kind: overlay.kind,
      content: overlay.content,
      source: ProjectGraphOverlaySource.OBSIDIAN,
    });
  }
};

const writeObsidianModulePages = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
): string[] => {
  const modules = collectProjectGraphModules(store, project.name);
  return modules.map((module) => {
    const modulePath = path.join(
      vaultRoot,
      projectSlug,
      'architecture',
      'modules',
      `${slugify(module.label)}.md`,
    );
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
    writeProjectGraphTextFileAtomically(modulePath, renderEditableModulePage(module, overlays, existing));
    return modulePath;
  });
};

const renderEditableModulePage = (
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
  preserveBlock(existing, 'module-notes') || '- Add module notes, confirmations, corrections, or risks here.',
  '<!-- mindstrate:project-graph:module-notes:end -->',
  '',
].join('\n');

const overlaySections = (overlays: ProjectGraphOverlay[]): string[] => [
  ...overlayLines('User Corrections', overlays, ProjectGraphOverlayKind.CORRECTION),
  ...overlayLines('User Risks', overlays, ProjectGraphOverlayKind.RISK),
  ...overlayLines('User Conventions', overlays, ProjectGraphOverlayKind.CONVENTION),
  ...overlayLines('User Confirmations', overlays, ProjectGraphOverlayKind.CONFIRMATION),
].filter((line, index, lines) => line.length > 0 || lines[index - 1]?.startsWith('## '));

const overlayLines = (
  title: string,
  overlays: ProjectGraphOverlay[],
  kind: ProjectGraphOverlayKind,
): string[] => {
  const matching = overlays.filter((overlay) => overlay.kind === kind);
  if (matching.length === 0) return [];
  return [
    `## ${title}`,
    '',
    ...matching.flatMap((overlay) => [
      `- ${overlay.content}`,
      ...(overlay.targetNodeId ? [`  - Target node: ${overlay.targetNodeId}`] : []),
      ...(overlay.targetEdgeId ? [`  - Target edge: ${overlay.targetEdgeId}`] : []),
    ]),
    '',
  ];
};

const moduleOverlays = (module: ProjectGraphModule, overlays: ProjectGraphOverlay[]): ProjectGraphOverlay[] => {
  const nodeIds = new Set(module.nodes);
  return overlays.filter((overlay) => !overlay.targetNodeId || nodeIds.has(overlay.targetNodeId));
};

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

const evidencePathsForNode = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  return Array.isArray(evidence)
    ? evidence
      .map(formatEvidenceLocation)
      .filter(Boolean)
    : [];
};

const formatEvidenceLocation = (entry: unknown): string => {
  if (!entry || typeof entry !== 'object' || !('path' in entry)) return '';
  const record = entry as Record<string, unknown>;
  const evidencePath = String(record.path);
  if (typeof record.startLine !== 'number') return evidencePath;
  if (typeof record.endLine === 'number' && record.endLine !== record.startLine) {
    return `${evidencePath}:${record.startLine}-${record.endLine}`;
  }
  return `${evidencePath}:${record.startLine}`;
};

const toArtifactNode = (node: ContextNode, overlays: ProjectGraphOverlay[] = []): ProjectGraphArtifactNode => {
  const metadata = node.metadata ?? {};
  const evidence = normalizeEvidence(metadata[PROJECT_GRAPH_METADATA_KEYS.evidence]);
  const hasConfirmation = overlays.some((overlay) =>
    overlay.kind === ProjectGraphOverlayKind.CONFIRMATION && overlay.targetNodeId === node.id);
  return {
    id: node.id,
    kind: String(metadata[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown'),
    label: node.title,
    project: node.project ?? '',
    path: evidence[0]?.path,
    sourceRef: node.sourceRef,
    provenance: String(metadata[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown'),
    confidence: hasConfirmation ? Math.max(node.confidence, 0.99) : node.confidence,
    salience: hasConfirmation ? Math.max(node.qualityScore, 99) : node.qualityScore,
    evidence,
    metadata,
  };
};

const toArtifactEdge = (edge: ReturnType<ContextGraphStore['listEdges']>[number]): ProjectGraphArtifactEdge => {
  const evidence = edge.evidence ?? {};
  return {
    id: edge.id,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    kind: String(evidence[PROJECT_GRAPH_METADATA_KEYS.kind] ?? edge.relationType),
    relationType: edge.relationType,
    confidence: edge.strength,
    evidence: normalizeEvidence(evidence[PROJECT_GRAPH_METADATA_KEYS.evidence]),
    metadata: evidence,
  };
};

const normalizeEvidence = (value: unknown): EvidenceRef[] => {
  if (!Array.isArray(value)) return [];
  const evidence: EvidenceRef[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !('path' in entry)) continue;
    const record = entry as Record<string, unknown>;
    evidence.push({
      path: String(record.path),
      startLine: typeof record.startLine === 'number' ? record.startLine : undefined,
      endLine: typeof record.endLine === 'number' ? record.endLine : undefined,
      extractorId: typeof record.extractorId === 'string' ? record.extractorId : 'unknown',
      captureName: typeof record.captureName === 'string' ? record.captureName : undefined,
      locationUnavailable: typeof record.locationUnavailable === 'boolean'
        ? record.locationUnavailable
        : typeof record.startLine !== 'number',
    });
  }
  return evidence;
};

export const writeProjectGraphTextFileAtomically = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
};

const countBy = <T>(items: T[], keyFor: (item: T) => string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};
