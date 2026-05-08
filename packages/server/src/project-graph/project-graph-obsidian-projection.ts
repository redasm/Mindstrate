import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectionTarget,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphModules } from './clustering.js';
import { listProjectGraphOverlays } from './overlay.js';
import { projectGraphOverlayProjectionForNode } from './overlay-application.js';
import { collectProjectGraphArtifact } from './project-graph-artifact.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import {
  renderEditableModulePage,
  renderEditableObsidianProjection,
  renderProjectGraphReport,
} from './project-graph-report-renderer.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';
import type { ProjectGraphArtifactResult } from './project-graph-report-types.js';
import { collectProjectGraphStats } from './project-graph-stats.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
): ProjectGraphArtifactResult => {
  const projectSlug = slugifyProjectGraphValue(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  importProjectGraphOverlayBlock(store, project.name, existing);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);
  const nodePaths = writeObsidianNodePages(graph, vaultRoot, projectSlug, overlays);

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
    nodePaths,
    nodes: stats.nodes,
    edges: stats.edges,
  };
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
      `${slugifyProjectGraphValue(module.label)}.md`,
    );
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
    writeProjectGraphTextFileAtomically(modulePath, renderEditableModulePage(module, overlays, existing));
    return modulePath;
  });
};

const writeObsidianNodePages = (
  graph: ProjectGraphArtifact,
  vaultRoot: string,
  projectSlug: string,
  overlays: ReturnType<typeof listProjectGraphOverlays>,
): string[] => {
  const nodeDir = path.join(vaultRoot, projectSlug, 'architecture', 'nodes');
  fs.mkdirSync(nodeDir, { recursive: true });
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = edgesBy(graph.edges, (edge) => edge.sourceId);
  const incoming = edgesBy(graph.edges, (edge) => edge.targetId);
  const written = new Set<string>();
  const paths: string[] = [];

  for (const node of graph.nodes) {
    const nodePath = path.join(nodeDir, `${nodePageSlug(node)}.md`);
    writeProjectGraphTextFileAtomically(nodePath, renderObsidianNodePage({
      node,
      outgoing: outgoing.get(node.id) ?? [],
      incoming: incoming.get(node.id) ?? [],
      nodeById,
      overlays,
    }));
    written.add(path.basename(nodePath));
    paths.push(nodePath);
  }

  const indexPath = path.join(nodeDir, 'index.md');
  writeProjectGraphTextFileAtomically(indexPath, renderObsidianNodeIndex(graph.nodes, overlays));
  written.add('index.md');
  paths.unshift(indexPath);

  for (const entry of fs.readdirSync(nodeDir)) {
    if (entry.endsWith('.md') && !written.has(entry)) fs.rmSync(path.join(nodeDir, entry));
  }

  return paths;
};

const renderObsidianNodeIndex = (nodes: ProjectGraphArtifactNode[], overlays: ReturnType<typeof listProjectGraphOverlays>): string => {
  const zh = resolveProjectGraphLocale() === 'zh';
  return [
    `# ${zh ? '图节点索引' : 'Graph Node Index'}`,
    '',
    ...nodes
      .slice()
      .sort((left, right) => `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`))
      .map((node) => `- [[nodes/${nodePageSlug(node)}|${escapeWikiLabel(projectGraphOverlayProjectionForNode(node, overlays).displayLabel)}]] (${node.kind})`),
    '',
  ].join('\n');
};

const renderObsidianNodePage = (input: {
  node: ProjectGraphArtifactNode;
  outgoing: ProjectGraphArtifactEdge[];
  incoming: ProjectGraphArtifactEdge[];
  nodeById: Map<string, ProjectGraphArtifactNode>;
  overlays: ReturnType<typeof listProjectGraphOverlays>;
}): string => {
  const zh = resolveProjectGraphLocale() === 'zh';
  const overlayProjection = projectGraphOverlayProjectionForNode(input.node, input.overlays);
  return [
    `# ${overlayProjection.displayLabel}`,
    '',
    ...(overlayProjection.displayLabel !== input.node.label ? [`- ${zh ? '原始标签' : 'Raw label'}: ${input.node.label}`] : []),
    `- ${zh ? '类型' : 'Kind'}: ${input.node.kind}`,
    `- ${zh ? '来源' : 'Provenance'}: ${input.node.provenance}`,
    `- ${zh ? '置信度' : 'Confidence'}: ${input.node.confidence}`,
    `- ${zh ? '项目' : 'Project'}: ${input.node.project}`,
    ...(overlayProjection.correction ? [`- ${zh ? '用户修正' : 'User correction'}: ${overlayProjection.correction}`] : []),
    '',
    `## ${zh ? '出向关系' : 'Outgoing Relations'}`,
    '',
    ...edgeLines(input.outgoing, input.nodeById, 'targetId', zh),
    '',
    `## ${zh ? '入向关系' : 'Incoming Relations'}`,
    '',
    ...edgeLines(input.incoming, input.nodeById, 'sourceId', zh),
    '',
    `## ${zh ? '证据' : 'Evidence'}`,
    '',
    ...(input.node.evidence.length > 0
      ? input.node.evidence.map((entry) => `- ${formatEvidence(entry.path, entry.startLine, entry.endLine)}`)
      : [zh ? '- 暂无证据。' : '- No evidence.']),
    '',
  ].join('\n');
};

const edgeLines = (
  edges: ProjectGraphArtifactEdge[],
  nodeById: Map<string, ProjectGraphArtifactNode>,
  linkedNodeKey: 'sourceId' | 'targetId',
  zh: boolean,
): string[] => {
  if (edges.length === 0) return [zh ? '- 暂无。' : '- None.'];
  return edges
    .slice()
    .sort((left, right) => `${left.kind}:${left[linkedNodeKey]}`.localeCompare(`${right.kind}:${right[linkedNodeKey]}`))
    .map((edge) => {
      const node = nodeById.get(edge[linkedNodeKey]);
      const target = node
        ? `[[nodes/${nodePageSlug(node)}|${escapeWikiLabel(node.label)}]]`
        : edge[linkedNodeKey];
      const evidence = edge.evidence[0]?.path ? ` (${formatEvidence(edge.evidence[0].path, edge.evidence[0].startLine, edge.evidence[0].endLine)})` : '';
      return `- ${edge.kind}: ${target}${evidence}`;
    });
};

const edgesBy = (
  edges: ProjectGraphArtifactEdge[],
  keyFor: (edge: ProjectGraphArtifactEdge) => string,
): Map<string, ProjectGraphArtifactEdge[]> => {
  const result = new Map<string, ProjectGraphArtifactEdge[]>();
  for (const edge of edges) {
    const key = keyFor(edge);
    const current = result.get(key) ?? [];
    current.push(edge);
    result.set(key, current);
  }
  return result;
};

const nodePageSlug = (node: ProjectGraphArtifactNode): string => {
  const slug = slugifyProjectGraphValue(`${node.kind}-${node.label}`);
  const hash = createHash('sha1').update(node.id).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
};

const escapeWikiLabel = (value: string): string => value.replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();

const formatEvidence = (filePath: string, startLine?: number, endLine?: number): string => {
  if (typeof startLine !== 'number') return filePath;
  if (typeof endLine === 'number' && endLine !== startLine) return `${filePath}:${startLine}-${endLine}`;
  return `${filePath}:${startLine}`;
};
