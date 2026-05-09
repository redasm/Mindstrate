import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  isProjectGraphEdge,
  isProjectGraphNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { listProjectGraphOverlays } from './overlay.js';
import { projectGraphOverlayProjectionForNode } from './overlay-application.js';
import type { ProjectGraphStatsExport } from './project-graph-report-types.js';
import { countBy, evidencePathsForNode, scoreFirstFile } from './project-graph-report-shared.js';
import { projectGraphNodeSalience, sortProjectGraphNodesBySalience } from './salience.js';

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
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const firstFiles = nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'file')
    .filter((node) => node.metadata?.['generated'] !== true)
    .sort((left, right) =>
      projectGraphNodeSalience({ node: right, edges, overlays }) - projectGraphNodeSalience({ node: left, edges, overlays })
      || scoreFirstFile(right.title) - scoreFirstFile(left.title)
      || left.title.localeCompare(right.title))
    .map((node) => node.title)
    .slice(0, 12);
  const entryPoints = firstFiles.slice(0, 8).map((label) => ({ label, evidencePaths: [label] }));
  const highImpactFiles = sortProjectGraphNodesBySalience(nodes
    .filter((node) => node.metadata?.['generated'] !== true)
    .filter((node) => impactTagsForNode(node).length > 0), edges, overlays)
    .slice(0, 12)
    .map((node) => ({
      label: projectGraphOverlayProjectionForNode(node, overlays).displayLabel,
      evidencePaths: evidencePathsForNode(node),
      impactTags: impactTagsForNode(node),
    }));
  const coreModules = sortProjectGraphNodesBySalience(nodes
    .filter((node) => ['project', 'directory', 'file'].includes(String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? '')))
    .filter((node) => node.metadata?.['generated'] !== true), edges, overlays)
    .slice(0, 8)
    .map((node) => ({ label: projectGraphOverlayProjectionForNode(node, overlays).displayLabel, evidencePaths: evidencePathsForNode(node) }));
  const assetSurfaces = nodes
    .filter((node) => node.metadata?.['scanMode'] === 'metadata-only' && typeof node.metadata?.['assetClass'] === 'string')
    .map((node) => ({ label: `${projectGraphOverlayProjectionForNode(node, overlays).displayLabel} (${node.metadata?.['assetClass']})`, evidencePaths: evidencePathsForNode(node) }))
    .sort((left, right) => left.label.localeCompare(right.label))
    .slice(0, 8);
  const bindingSurfaces = sortProjectGraphNodesBySalience(nodes
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] === 'dependency'), edges, overlays)
    .map((node) => ({ label: projectGraphOverlayProjectionForNode(node, overlays).displayLabel, evidencePaths: evidencePathsForNode(node) }))
    .slice(0, 8);

  return {
    project: project.name,
    generatedAt: new Date().toISOString(),
    nodes: nodes.length,
    edges: edges.length,
    projectionNodeId: nodes[0]?.id,
    firstFiles,
    highImpactFiles,
    entryPoints,
    coreModules,
    assetSurfaces,
    bindingSurfaces,
    overlays,
    inferredSummaries: nodes
      .filter((node) => String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] ?? '') === 'INFERRED')
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

const impactTagsForNode = (node: { metadata?: Record<string, unknown> }): string[] => {
  const tags = node.metadata?.['impactTags'];
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0) : [];
};
