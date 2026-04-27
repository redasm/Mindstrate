import { cosineSimilarity } from '../math.js';
import { Embedder } from '../processing/embedder.js';
import { clusterContextNodes, hasGeneralizationParent, lexicalOverlap } from './context-clustering.js';
import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
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
  private readonly graphStore: ContextGraphStore;
  private readonly embedder: Embedder;

  constructor(graphStore: ContextGraphStore, embedder: Embedder) {
    this.graphStore = graphStore;
    this.embedder = embedder;
  }

  async compressProjectSummaries(
    options: PatternCompressionOptions = {},
  ): Promise<PatternCompressionResult> {
    const minClusterSize = options.minClusterSize ?? 2;
    const minPositiveFeedback = options.minPositiveFeedback ?? 3;
    const minDistinctProjects = options.minDistinctProjects ?? 1;
    const similarityThreshold = options.similarityThreshold ?? 0.8;
    const limit = options.limit ?? 200;

    const summaries = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit,
    });

    const eligible = summaries.filter((summary) => (
      !hasGeneralizationParent(this.graphStore, summary.id, SubstrateType.PATTERN)
    ));
    const clusters = await clusterContextNodes({
      nodes: eligible,
      embedder: this.embedder,
      minClusterSize,
      similarityThreshold,
      promoteSingleton: (summary) => (
        summary.positiveFeedback >= minPositiveFeedback && summary.positiveFeedback > summary.negativeFeedback
      ),
      similarity: ({ node, candidate, nodeEmbedding, candidateEmbedding }) => Math.max(
        lexicalOverlap(node.content, candidate.content),
        cosineSimilarity(nodeEmbedding, candidateEmbedding),
      ),
    });

    const resultClusters: PatternCompressionResult['clusters'] = [];
    for (const cluster of clusters) {
      const patternNode = this.graphStore.createNode({
        substrateType: SubstrateType.PATTERN,
        domainType: ContextDomainType.PATTERN,
        title: buildPatternTitle(cluster),
        content: buildPatternContent(cluster),
        tags: ['pattern-compression', 'session-pattern'],
        project: isCrossProjectCluster(cluster, minDistinctProjects) ? undefined : cluster[0].project,
        compressionLevel: 0.03,
        confidence: 0.8,
        qualityScore: 80,
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          sourceSummaryIds: cluster.map((item) => item.id),
          sourceProjects: [...new Set(cluster.map((item) => item.project).filter(Boolean))],
          clusterSize: cluster.length,
          promotionReason: getPromotionReason(cluster, minDistinctProjects),
        },
      });

      for (const summary of cluster) {
        this.graphStore.createEdge({
          sourceId: summary.id,
          targetId: patternNode.id,
          relationType: ContextRelationType.GENERALIZES,
          strength: 1,
          evidence: { sourceSummaryId: summary.id },
        });
      }

      resultClusters.push({
        patternNodeId: patternNode.id,
        sourceSummaryIds: cluster.map((item) => item.id),
      });
    }

    return {
      scannedSummaries: eligible.length,
      patternNodesCreated: resultClusters.length,
      clusters: resultClusters,
    };
  }
}

function buildPatternTitle(cluster: ContextNode[]): string {
  const project = cluster[0].project || 'default';
  return `Session pattern: ${project} (${cluster.length} summaries)`;
}

function buildPatternContent(cluster: ContextNode[]): string {
  const bullets = cluster.map((summary, index) => {
    const firstLine = summary.content.split('\n')[0] ?? summary.title;
    return `${index + 1}. ${summary.title}\n${firstLine}`;
  });

  return [
    `Abstracted from ${cluster.length} similar session summaries.`,
    '',
    ...bullets,
  ].join('\n');
}

function isCrossProjectCluster(cluster: ContextNode[], minDistinctProjects: number): boolean {
  const projects = new Set(cluster.map((node) => node.project).filter(Boolean));
  return projects.size >= Math.max(minDistinctProjects, 2);
}

function getPromotionReason(cluster: ContextNode[], minDistinctProjects: number): string {
  if (cluster.length === 1) return 'high_positive_feedback';
  if (isCrossProjectCluster(cluster, minDistinctProjects)) return 'cross_project_validation';
  return 'similarity_cluster';
}
