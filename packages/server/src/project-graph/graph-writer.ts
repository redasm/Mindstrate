import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
  SubstrateType,
  isProjectGraphNode,
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
        [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
        [PROJECT_GRAPH_METADATA_KEYS.kind]: edge.kind,
        [PROJECT_GRAPH_METADATA_KEYS.provenance]: edge.provenance,
        [PROJECT_GRAPH_METADATA_KEYS.evidence]: edge.evidence,
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
  const nodes = store.listNodes({ project: input.project, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })
    .filter(isProjectGraphNode)
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.ownedByFile] === input.filePath);

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
  [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
  [PROJECT_GRAPH_METADATA_KEYS.kind]: node.kind,
  [PROJECT_GRAPH_METADATA_KEYS.provenance]: node.provenance,
  [PROJECT_GRAPH_METADATA_KEYS.evidence]: node.evidence,
  [PROJECT_GRAPH_METADATA_KEYS.ownedByFile]: node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.ownedByFile] ?? node.evidence[0]?.path,
});

const relationForProjectGraphEdge = (kind: ProjectGraphEdgeKind): ContextRelationType => {
  if (kind === ProjectGraphEdgeKind.IMPORTS || kind === ProjectGraphEdgeKind.DEPENDS_ON) {
    return ContextRelationType.DEPENDS_ON;
  }
  if (kind === ProjectGraphEdgeKind.BINDS_TO || kind === ProjectGraphEdgeKind.REFLECTS) return ContextRelationType.APPLIES_TO;
  if (kind === ProjectGraphEdgeKind.REFERENCES_ASSET || kind === ProjectGraphEdgeKind.OWNS_ASSET) return ContextRelationType.OBSERVED_IN;
  if (kind === ProjectGraphEdgeKind.DOCUMENTS) return ContextRelationType.OBSERVED_IN;
  if (kind === ProjectGraphEdgeKind.RELATED_TO) return ContextRelationType.SUPPORTS;
  return ContextRelationType.APPLIES_TO;
};
