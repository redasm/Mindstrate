import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphProvenance,
  type ContextNode,
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
  edgesUpdated: number;
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
  const result = emptyWriteResult();

  // One transaction for the whole graph: a first-run index of a large checkout
  // is 100k+ node + edge writes. Outside a transaction each write fsyncs on its
  // own (minutes of wall-clock, and a process restart mid-write strands the run
  // as orphaned with a partial graph). Committing once makes it fast and atomic
  // — a crash rolls back to an empty graph the next run can rebuild cleanly.
  store.transaction(() => {
    applyNodeWrites(store, extraction.nodes, result);
    applyEdgeWrites(store, extraction.edges, result);
  });

  return result;
};

export const emptyWriteResult = (): ProjectGraphWriteResult => ({
  nodesCreated: 0,
  nodesUpdated: 0,
  edgesCreated: 0,
  edgesUpdated: 0,
  edgesSkipped: 0,
});

/**
 * Upsert nodes into the store, mutating `result` counts. Caller owns the
 * transaction (so node + edge writes commit together).
 */
export const applyNodeWrites = (
  store: ContextGraphStore,
  nodes: ProjectGraphNodeDto[],
  result: ProjectGraphWriteResult,
): void => {
  for (const node of nodes) {
    try {
      if (store.getNodeById(node.id)) {
        store.updateNode(node.id, toContextNodeUpdate(node));
        result.nodesUpdated++;
      } else {
        store.createNode(toContextNodeCreate(node));
        result.nodesCreated++;
      }
    } catch (error) {
      throw new Error(`writing project graph node "${node.label}" (${node.kind}, ${node.id}) failed: ${errorMessage(error)}`);
    }
  }
};

/**
 * Streaming counterpart to {@link applyNodeWrites} that preserves the in-memory
 * `addNode` merge semantics without an in-memory graph.
 *
 * `seen` tracks node ids already written *this run*:
 *  - First time a node id is seen this run, its previous-run row (if any) is
 *    fully replaced — stale facts from an earlier index don't accumulate.
 *  - Subsequent occurrences this run are *merged* into the current row (metadata
 *    keys unioned with the newer file winning, evidence lists unioned), matching
 *    what `addNode` did when every file fed one resident map.
 *
 * Caller owns the transaction.
 */
export const applyStreamedNodeWrites = (
  store: ContextGraphStore,
  nodes: ProjectGraphNodeDto[],
  seen: Set<string>,
  result: ProjectGraphWriteResult,
): void => {
  for (const node of nodes) {
    try {
      if (seen.has(node.id)) {
        const existing = store.getNodeById(node.id);
        if (existing) store.updateNode(node.id, mergeNodeUpdate(existing, node));
        continue;
      }
      seen.add(node.id);
      if (store.getNodeById(node.id)) {
        store.updateNode(node.id, toContextNodeUpdate(node));
        result.nodesUpdated++;
      } else {
        store.createNode(toContextNodeCreate(node));
        result.nodesCreated++;
      }
    } catch (error) {
      throw new Error(`writing project graph node "${node.label}" (${node.kind}, ${node.id}) failed: ${errorMessage(error)}`);
    }
  }
};

const mergeNodeUpdate = (existing: ContextNode, node: ProjectGraphNodeDto) => {
  const update = toContextNodeUpdate(node);
  const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>;
  const newMeta = (update.metadata ?? {}) as Record<string, unknown>;
  return {
    ...update,
    metadata: {
      ...existingMeta,
      ...newMeta,
      [PROJECT_GRAPH_METADATA_KEYS.evidence]: mergeEvidenceRefs(
        existingMeta[PROJECT_GRAPH_METADATA_KEYS.evidence],
        newMeta[PROJECT_GRAPH_METADATA_KEYS.evidence],
      ),
    },
  };
};

const mergeEvidenceRefs = (left: unknown, right: unknown): unknown[] => {
  const merged = new Map<string, unknown>();
  for (const ref of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    merged.set(JSON.stringify(ref), ref);
  }
  return Array.from(merged.values());
};

/**
 * Upsert edges into the store, mutating `result` counts. Reused by the SQL
 * binding pass so its `BINDS_TO` / `GENERATED_FROM` edges share the exact same
 * serialization (relation mapping, strength, evidence envelope) as extraction.
 * Caller owns the transaction.
 */
export const applyEdgeWrites = (
  store: ContextGraphStore,
  edges: ProjectGraphEdgeDto[],
  result: ProjectGraphWriteResult,
): void => {
  for (const edge of edges) {
    try {
      const edgeInput = toContextEdgeInput(edge);
      const existing = store.getEdgeById(edge.id);
      if (existing) {
        if (
          existing.relationType === edgeInput.relationType
          && existing.strength === edgeInput.strength
          && JSON.stringify(existing.evidence ?? null) === JSON.stringify(edgeInput.evidence ?? null)
        ) {
          result.edgesSkipped++;
          continue;
        }
        store.updateEdge(edge.id, edgeInput);
        result.edgesUpdated++;
        continue;
      }
      store.createEdge(edgeInput);
      result.edgesCreated++;
    } catch (error) {
      throw new Error(`writing project graph edge ${edge.kind} (${edge.sourceId} -> ${edge.targetId}, ${edge.id}) failed: ${errorMessage(error)}`);
    }
  }
};

const toContextEdgeInput = (edge: ProjectGraphEdgeDto) => ({
  id: edge.id,
  sourceId: edge.sourceId,
  targetId: edge.targetId,
  relationType: relationForProjectGraphEdge(edge.kind),
  strength: confidenceForProjectGraphEvidence(edge),
  evidence: {
    [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true,
    [PROJECT_GRAPH_METADATA_KEYS.kind]: edge.kind,
    [PROJECT_GRAPH_METADATA_KEYS.provenance]: edge.provenance,
    [PROJECT_GRAPH_METADATA_KEYS.evidence]: edge.evidence,
    ...(edge.metadata ?? {}),
  },
});

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
  confidence: confidenceForProjectGraphNode(node),
  qualityScore: qualityScoreForProjectGraphNode(node),
  status: ContextNodeStatus.ACTIVE,
  sourceRef: node.evidence[0]?.path,
  metadata: projectGraphNodeMetadata(node),
});

const toContextNodeUpdate = (node: ProjectGraphNodeDto) => ({
  title: node.label,
  content: `${node.kind}: ${node.label}`,
  tags: ['project-graph', node.kind],
  project: node.project,
  confidence: confidenceForProjectGraphNode(node),
  qualityScore: qualityScoreForProjectGraphNode(node),
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

const confidenceForProjectGraphNode = (node: ProjectGraphNodeDto): number => {
  return confidenceForProjectGraphEvidence(node);
};

const confidenceForProjectGraphEvidence = (
  item: Pick<ProjectGraphNodeDto | ProjectGraphEdgeDto, 'provenance' | 'evidence'>,
): number => {
  if (item.provenance === ProjectGraphProvenance.AMBIGUOUS) return 0.45;
  if (item.provenance === ProjectGraphProvenance.INFERRED) return 0.65;
  const extractorIds = item.evidence.map((entry) => entry.extractorId);
  if (extractorIds.some((id) => id.includes('tree-sitter') || id.includes('unreal-asset-registry'))) return 0.95;
  if (extractorIds.some((id) => id.includes('unreal') || id.includes('script'))) return 0.85;
  return 0.8;
};

const qualityScoreForProjectGraphNode = (node: ProjectGraphNodeDto): number =>
  Math.round(confidenceForProjectGraphNode(node) * 100);

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

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
