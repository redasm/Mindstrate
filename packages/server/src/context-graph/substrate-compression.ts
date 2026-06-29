import type { Embedder } from '../processing/embedder.js';
import { clusterContextNodes, hasGeneralizationParent, type ContextClusterOptions } from './context-clustering.js';
import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextNodeStatus,
  ContextRelationType,
  type ContextDomainType,
  type ContextNode,
  type SubstrateType,
} from '@mindstrate/protocol/models';

export interface SubstrateCompressionOptions {
  project?: string;
  minClusterSize?: number;
  similarityThreshold?: number;
  limit?: number;
}

export interface SubstrateCompressionSpec {
  sourceType: SubstrateType;
  sourceDomain?: ContextDomainType;
  targetType: SubstrateType;
  targetDomain: ContextDomainType;
  tags: string[];
  compressionLevel: number;
  confidence: number;
  qualityScore: number;
  /**
   * Status assigned to the compressed target node. Defaults to `active`.
   * High-order substrates (skill / heuristic / axiom) pass `candidate`
   * so the SkillOpt-style gate, not the compressor, decides promotion.
   */
  targetStatus?: ContextNodeStatus;
  defaultSimilarityThreshold: number;
  title: (cluster: ContextNode[]) => string;
  content: (cluster: ContextNode[]) => string;
  project?: (cluster: ContextNode[]) => string | undefined;
  metadata?: (cluster: ContextNode[]) => Record<string, unknown>;
  evidence?: (source: ContextNode) => Record<string, unknown>;
  promoteSingleton?: ContextClusterOptions['promoteSingleton'];
  similarity?: ContextClusterOptions['similarity'];
  /** Require cluster-wide cohesion, not just seed similarity (high-order). */
  requireIntraClusterCohesion?: boolean;
  /**
   * Optional async synthesis of the target node's title/content from the
   * cluster (e.g. an LLM generalization). Returning null skips the cluster —
   * no node is created — which lets callers refuse to emit a node when no LLM
   * is available or the model judges the cluster spurious, instead of writing
   * a template placeholder.
   */
  synthesize?: (cluster: ContextNode[]) => Promise<{ title: string; content: string } | null>;
}

export interface SubstrateCompressionRun {
  scannedNodes: number;
  clusters: Array<{
    targetNode: ContextNode;
    sourceNodes: ContextNode[];
  }>;
}

export const runSubstrateCompression = async (
  graphStore: ContextGraphStore,
  embedder: Embedder,
  spec: SubstrateCompressionSpec,
  options: SubstrateCompressionOptions,
): Promise<SubstrateCompressionRun> => {
  const minClusterSize = options.minClusterSize ?? 2;
  const similarityThreshold = options.similarityThreshold ?? spec.defaultSimilarityThreshold;
  const limit = options.limit ?? 200;
  const nodes = graphStore.listNodes({
    project: options.project,
    substrateType: spec.sourceType,
    domainType: spec.sourceDomain,
    limit,
  });
  const eligible = nodes.filter((node) => !hasGeneralizationParent(graphStore, node.id, spec.targetType));
  const clusters = await clusterContextNodes({
    nodes: eligible,
    embedder,
    minClusterSize,
    similarityThreshold,
    promoteSingleton: spec.promoteSingleton,
    similarity: spec.similarity,
    requireIntraClusterCohesion: spec.requireIntraClusterCohesion,
  });

  const built: Array<{ targetNode: ContextNode; sourceNodes: ContextNode[] }> = [];
  for (const cluster of clusters) {
    // Optional synthesis (e.g. LLM generalization): null → skip this cluster
    // entirely rather than persist a template placeholder.
    let synthesized: { title: string; content: string } | undefined;
    if (spec.synthesize) {
      const result = await spec.synthesize(cluster);
      if (!result) continue;
      synthesized = result;
    }
    built.push({
      targetNode: createTargetNode(graphStore, spec, cluster, synthesized),
      sourceNodes: cluster,
    });
  }

  return {
    scannedNodes: eligible.length,
    clusters: built,
  };
};

const createTargetNode = (
  graphStore: ContextGraphStore,
  spec: SubstrateCompressionSpec,
  cluster: ContextNode[],
  synthesized?: { title: string; content: string },
): ContextNode => {
  const targetNode = graphStore.createNode({
    substrateType: spec.targetType,
    domainType: spec.targetDomain,
    title: synthesized?.title ?? spec.title(cluster),
    content: synthesized?.content ?? spec.content(cluster),
    tags: spec.tags,
    project: spec.project ? spec.project(cluster) : cluster[0].project,
    compressionLevel: spec.compressionLevel,
    confidence: spec.confidence,
    qualityScore: spec.qualityScore,
    status: spec.targetStatus ?? ContextNodeStatus.ACTIVE,
    metadata: {
      clusterSize: cluster.length,
      ...(synthesized ? { llmSynthesized: true } : {}),
      ...spec.metadata?.(cluster),
    },
  });

  for (const source of cluster) {
    graphStore.createEdge({
      sourceId: source.id,
      targetId: targetNode.id,
      relationType: ContextRelationType.GENERALIZES,
      strength: 1,
      evidence: spec.evidence?.(source),
    });
  }

  return targetNode;
};
