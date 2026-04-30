import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectionTarget,
  isProjectGraphEdge,
  isProjectGraphNode,
  type EvidenceRef,
  type ContextNode,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';

export interface ProjectGraphArtifactResult {
  reportPath: string;
  statsPath: string;
  graphPath: string;
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
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const report = renderEditableObsidianProjection(generated, existing);
  const graph = collectProjectGraphArtifact(store, project, stats);

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
      .map(toArtifactNode)
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges
      .map(toArtifactEdge)
      .sort((left, right) => left.id.localeCompare(right.id)),
    overlays: [],
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
    .map((node) => node.title)
    .sort((left, right) => scoreFirstFile(right) - scoreFirstFile(left) || left.localeCompare(right))
    .slice(0, 12);

  return {
    project: project.name,
    generatedAt: new Date().toISOString(),
    nodes: nodes.length,
    edges: edges.length,
    projectionNodeId: nodes[0]?.id,
    firstFiles,
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
  '## Inferred Summaries',
  '',
  ...inferredSummaryLines(stats.inferredSummaries),
  '',
  '## Open Questions',
  '',
  ...openQuestionLines(stats.openQuestions),
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

const toArtifactNode = (node: ContextNode): ProjectGraphArtifactNode => {
  const metadata = node.metadata ?? {};
  const evidence = normalizeEvidence(metadata[PROJECT_GRAPH_METADATA_KEYS.evidence]);
  return {
    id: node.id,
    kind: String(metadata[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown'),
    label: node.title,
    project: node.project ?? '',
    path: evidence[0]?.path,
    sourceRef: node.sourceRef,
    provenance: String(metadata[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? 'unknown'),
    confidence: node.confidence,
    salience: node.qualityScore,
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
