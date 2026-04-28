import { cosineSimilarity } from '../math.js';
import type { Embedder } from '../processing/embedder.js';
import { lexicalOverlap } from './context-clustering.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { buildClusterContent, runSubstrateCompression } from './substrate-compression.js';
import {
  ContextDomainType,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';

export interface PatternCompressionOptions {
  project?: string;
  minClusterSize?: number;
  minPositiveFeedback?: number;
  minDistinctProjects?: number;
  similarityThreshold?: number;
  limit?: number;
}

export interface PatternCompressionResult {
  scannedSummaries: number;
  patternNodesCreated: number;
  clusters: Array<{
    patternNodeId: string;
    sourceSummaryIds: string[];
  }>;
}

export class PatternCompressor {
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly embedder: Embedder,
  ) {}

  async compressProjectSummaries(
    options: PatternCompressionOptions = {},
  ): Promise<PatternCompressionResult> {
    const minPositiveFeedback = options.minPositiveFeedback ?? 3;
    const minDistinctProjects = options.minDistinctProjects ?? 1;
    const run = await runSubstrateCompression(this.graphStore, this.embedder, {
      sourceType: SubstrateType.SUMMARY,
      sourceDomain: ContextDomainType.SESSION_SUMMARY,
      targetType: SubstrateType.PATTERN,
      targetDomain: ContextDomainType.PATTERN,
      tags: ['pattern-compression', 'session-pattern'],
      compressionLevel: 0.03,
      confidence: 0.8,
      qualityScore: 80,
      defaultSimilarityThreshold: 0.8,
      title: buildPatternTitle,
      content: buildPatternContent,
      project: (cluster) => isCrossProjectCluster(cluster, minDistinctProjects) ? undefined : cluster[0].project,
      metadata: (cluster) => ({
        sourceSummaryIds: cluster.map((item) => item.id),
        sourceProjects: [...new Set(cluster.map((item) => item.project).filter(Boolean))],
        promotionReason: getPromotionReason(cluster, minDistinctProjects),
      }),
      evidence: (summary) => ({ sourceSummaryId: summary.id }),
      promoteSingleton: (summary) => (
        summary.positiveFeedback >= minPositiveFeedback && summary.positiveFeedback > summary.negativeFeedback
      ),
      similarity: ({ node, candidate, nodeEmbedding, candidateEmbedding }) => Math.max(
        lexicalOverlap(node.content, candidate.content),
        cosineSimilarity(nodeEmbedding, candidateEmbedding),
      ),
    }, options);

    return {
      scannedSummaries: run.scannedNodes,
      patternNodesCreated: run.clusters.length,
      clusters: run.clusters.map(({ targetNode, sourceNodes }) => ({
        patternNodeId: targetNode.id,
        sourceSummaryIds: sourceNodes.map((item) => item.id),
      })),
    };
  }
}

const buildPatternTitle = (cluster: ContextNode[]): string => {
  const project = cluster[0].project || 'default';
  return `Session pattern: ${project} (${cluster.length} summaries)`;
};

const buildPatternContent = (cluster: ContextNode[]): string => buildClusterContent(
  `Abstracted from ${cluster.length} similar session summaries.`,
  cluster,
);

const isCrossProjectCluster = (cluster: ContextNode[], minDistinctProjects: number): boolean => {
  const projects = new Set(cluster.map((node) => node.project).filter(Boolean));
  return projects.size >= Math.max(minDistinctProjects, 2);
};

const getPromotionReason = (cluster: ContextNode[], minDistinctProjects: number): string => {
  if (cluster.length === 1) return 'high_positive_feedback';
  if (isCrossProjectCluster(cluster, minDistinctProjects)) return 'cross_project_validation';
  return 'similarity_cluster';
};
