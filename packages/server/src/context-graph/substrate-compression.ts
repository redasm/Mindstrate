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
  defaultSimilarityThreshold: number;
  title: (cluster: ContextNode[]) => string;
  content: (cluster: ContextNode[]) => string;
  project?: (cluster: ContextNode[]) => string | undefined;
  metadata?: (cluster: ContextNode[]) => Record<string, unknown>;
  evidence?: (source: ContextNode) => Record<string, unknown>;
  promoteSingleton?: ContextClusterOptions['promoteSingleton'];
  similarity?: ContextClusterOptions['similarity'];
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
  });

  return {
    scannedNodes: eligible.length,
    clusters: clusters.map((cluster) => ({
      targetNode: createTargetNode(graphStore, spec, cluster),
      sourceNodes: cluster,
    })),
  };
};

export const buildClusterContent = (
  intro: string,
  cluster: ContextNode[],
): string => [
  intro,
  '',
  ...cluster.map((node, index) => `${index + 1}. ${node.title}\n${node.content.split('\n')[0] ?? node.title}`),
].join('\n');

const createTargetNode = (
  graphStore: ContextGraphStore,
  spec: SubstrateCompressionSpec,
  cluster: ContextNode[],
): ContextNode => {
  const targetNode = graphStore.createNode({
    substrateType: spec.targetType,
    domainType: spec.targetDomain,
    title: spec.title(cluster),
    content: spec.content(cluster),
    tags: spec.tags,
    project: spec.project ? spec.project(cluster) : cluster[0].project,
    compressionLevel: spec.compressionLevel,
    confidence: spec.confidence,
    qualityScore: spec.qualityScore,
    status: ContextNodeStatus.ACTIVE,
    metadata: {
      clusterSize: cluster.length,
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
