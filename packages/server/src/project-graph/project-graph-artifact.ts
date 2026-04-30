import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  isProjectGraphEdge,
  isProjectGraphNode,
  type ContextNode,
  type EvidenceRef,
  type ProjectGraphArtifact,
  type ProjectGraphArtifactEdge,
  type ProjectGraphArtifactNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { listProjectGraphOverlays } from './overlay.js';
import { collectProjectGraphStats } from './project-graph-stats.js';
import type { ProjectGraphStatsExport } from './project-graph-report-types.js';

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
