import { cosineSimilarity } from '../math.js';
import { Embedder } from '../processing/embedder.js';
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
    const similarityThreshold = options.similarityThreshold ?? 0.8;
    const limit = options.limit ?? 200;

    const summaries = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SUMMARY,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit,
    });

    const eligible = summaries.filter((summary) => !this.hasPatternParent(summary.id));
    const embeddings = new Map<string, number[]>();
    for (const summary of eligible) {
      embeddings.set(summary.id, await this.embedder.embed(summary.content));
    }

    const visited = new Set<string>();
    const clusters: ContextNode[][] = [];

    for (const summary of eligible) {
      if (visited.has(summary.id)) continue;
      visited.add(summary.id);

      const cluster = [summary];
      const currentEmbedding = embeddings.get(summary.id);
      if (!currentEmbedding) continue;

      for (const candidate of eligible) {
        if (candidate.id === summary.id || visited.has(candidate.id)) continue;
        const candidateEmbedding = embeddings.get(candidate.id);
        if (!candidateEmbedding) continue;

        const similarity = cosineSimilarity(currentEmbedding, candidateEmbedding);
        if (similarity >= similarityThreshold) {
          visited.add(candidate.id);
          cluster.push(candidate);
        }
      }

      if (cluster.length >= minClusterSize) {
        clusters.push(cluster);
      }
    }

    const resultClusters: PatternCompressionResult['clusters'] = [];
    for (const cluster of clusters) {
      const patternNode = this.graphStore.createNode({
        substrateType: SubstrateType.PATTERN,
        domainType: ContextDomainType.PATTERN,
        title: buildPatternTitle(cluster),
        content: buildPatternContent(cluster),
        tags: ['pattern-compression', 'session-pattern'],
        project: cluster[0].project,
        compressionLevel: 0.03,
        confidence: 0.8,
        qualityScore: 80,
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          sourceSummaryIds: cluster.map((item) => item.id),
          clusterSize: cluster.length,
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

  private hasPatternParent(summaryId: string): boolean {
    return this.graphStore.listOutgoingEdges(summaryId).some((edge) => {
      if (edge.relationType !== ContextRelationType.GENERALIZES) return false;
      const target = this.graphStore.getNodeById(edge.targetId);
      return target?.substrateType === SubstrateType.PATTERN;
    });
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
