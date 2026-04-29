import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  ProjectGraphEdgeKind,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface ProjectGraphExtractionResult {
  project: string;
  nodes: ProjectGraphNodeDto[];
  edges: ProjectGraphEdgeDto[];
}

export interface ProjectGraphWriteResult {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesSkipped: number;
}

export interface ArchiveProjectGraphFileFactsInput {
  project: string;
  filePath: string;
}

export const writeProjectGraphExtraction = (
  store: ContextGraphStore,
  extraction: ProjectGraphExtractionResult,
): ProjectGraphWriteResult => {
  const result: ProjectGraphWriteResult = {
    nodesCreated: 0,
    nodesUpdated: 0,
    edgesCreated: 0,
    edgesSkipped: 0,
  };

  for (const node of extraction.nodes) {
    if (store.getNodeById(node.id)) {
      store.updateNode(node.id, toContextNodeUpdate(node));
      result.nodesUpdated++;
    } else {
      store.createNode(toContextNodeCreate(node));
      result.nodesCreated++;
    }
  }

  for (const edge of extraction.edges) {
    if (store.getEdgeById(edge.id)) {
      result.edgesSkipped++;
      continue;
    }
    store.createEdge({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relationType: relationForProjectGraphEdge(edge.kind),
      strength: 1,
      evidence: {
        projectGraph: true,
        kind: edge.kind,
        provenance: edge.provenance,
        evidence: edge.evidence,
        ...(edge.metadata ?? {}),
      },
    });
    result.edgesCreated++;
  }

  return result;
};

export const archiveProjectGraphFileFacts = (
  store: ContextGraphStore,
  input: ArchiveProjectGraphFileFactsInput,
): number => {
  const nodes = store.listNodes({ project: input.project, limit: 100000 })
    .filter((node) => node.metadata?.['projectGraph'] === true)
    .filter((node) => node.metadata?.['ownedByFile'] === input.filePath);

  for (const node of nodes) {
    store.updateNode(node.id, { status: ContextNodeStatus.ARCHIVED });
  }

  return nodes.length;
};

const toContextNodeCreate = (node: ProjectGraphNodeDto) => ({
  id: node.id,
  substrateType: SubstrateType.SNAPSHOT,
  domainType: ContextDomainType.ARCHITECTURE,
  title: node.label,
  content: `${node.kind}: ${node.label}`,
  tags: ['project-graph', node.kind],
  project: node.project,
  compressionLevel: 1,
  confidence: 1,
  qualityScore: 80,
  status: ContextNodeStatus.ACTIVE,
  sourceRef: node.evidence[0]?.path,
  metadata: projectGraphNodeMetadata(node),
});

const toContextNodeUpdate = (node: ProjectGraphNodeDto) => ({
  title: node.label,
  content: `${node.kind}: ${node.label}`,
  tags: ['project-graph', node.kind],
  project: node.project,
  confidence: 1,
  qualityScore: 80,
  status: ContextNodeStatus.ACTIVE,
  sourceRef: node.evidence[0]?.path,
  metadata: projectGraphNodeMetadata(node),
});

const projectGraphNodeMetadata = (node: ProjectGraphNodeDto): Record<string, unknown> => ({
  ...(node.metadata ?? {}),
  projectGraph: true,
  kind: node.kind,
  provenance: node.provenance,
  evidence: node.evidence,
  ownedByFile: node.metadata?.['ownedByFile'] ?? node.evidence[0]?.path,
});

const relationForProjectGraphEdge = (kind: ProjectGraphEdgeKind): ContextRelationType => {
  if (kind === ProjectGraphEdgeKind.IMPORTS || kind === ProjectGraphEdgeKind.DEPENDS_ON) {
    return ContextRelationType.DEPENDS_ON;
  }
  if (kind === ProjectGraphEdgeKind.DOCUMENTS) return ContextRelationType.OBSERVED_IN;
  if (kind === ProjectGraphEdgeKind.RELATED_TO) return ContextRelationType.SUPPORTS;
  return ContextRelationType.APPLIES_TO;
};
