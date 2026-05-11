/**
 * Obsidian per-node pages writer.
 *
 * Owns rendering of `architecture/nodes/<slug>.md` plus the index page
 * that links them together. Stale node pages from earlier projections
 * are pruned to keep the directory in sync with the current graph.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  ProjectGraphArtifact,
  ProjectGraphArtifactEdge,
  ProjectGraphArtifactNode,
} from '@mindstrate/protocol/models';
import type { listProjectGraphOverlays } from './overlay.js';
import { projectGraphOverlayProjectionForNode } from './overlay-application.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';
import { formatEvidenceLocation } from './obsidian-rendering-shared.js';

type Overlays = ReturnType<typeof listProjectGraphOverlays>;

export const writeObsidianNodePages = (
  graph: ProjectGraphArtifact,
  vaultRoot: string,
  projectSlug: string,
  overlays: Overlays,
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

export const nodePageSlug = (node: ProjectGraphArtifactNode): string => {
  const slug = slugifyProjectGraphValue(`${node.kind}-${node.label}`);
  const hash = createHash('sha1').update(node.id).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
};

const renderObsidianNodeIndex = (nodes: ProjectGraphArtifactNode[], overlays: Overlays): string => {
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
  overlays: Overlays;
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
      ? input.node.evidence.map((entry) => `- ${formatEvidenceLocation(entry.path, entry.startLine, entry.endLine)}`)
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
      const evidence = edge.evidence[0]?.path
        ? ` (${formatEvidenceLocation(edge.evidence[0].path, edge.evidence[0].startLine, edge.evidence[0].endLine)})`
        : '';
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

const escapeWikiLabel = (value: string): string => value.replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
