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
import type { ProjectGraphStatsExport } from './project-graph-report-types.js';
import { countBy, evidencePathsForNode, scoreFirstFile } from './project-graph-report-shared.js';

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
