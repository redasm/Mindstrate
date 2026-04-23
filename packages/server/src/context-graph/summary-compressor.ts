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

export interface SummaryCompressionOptions {
  project?: string;
  minClusterSize?: number;
  similarityThreshold?: number;
  limit?: number;
}

export interface SummaryCompressionResult {
  scannedSnapshots: number;
  summaryNodesCreated: number;
  clusters: Array<{
    summaryNodeId: string;
    sourceSnapshotIds: string[];
  }>;
}

export class SummaryCompressor {
  private readonly graphStore: ContextGraphStore;
  private readonly embedder: Embedder;

  constructor(graphStore: ContextGraphStore, embedder: Embedder) {
    this.graphStore = graphStore;
    this.embedder = embedder;
  }

  async compressProjectSnapshots(
    options: SummaryCompressionOptions = {},
  ): Promise<SummaryCompressionResult> {
    const minClusterSize = options.minClusterSize ?? 2;
    const similarityThreshold = options.similarityThreshold ?? 0.78;
    const limit = options.limit ?? 200;

    const snapshots = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit,
    });

    const eligible = snapshots.filter((snapshot) => !this.hasSummaryParent(snapshot.id));
    const embeddings = new Map<string, number[]>();
    for (const snapshot of eligible) {
      embeddings.set(snapshot.id, await this.embedder.embed(snapshot.content));
    }

    const visited = new Set<string>();
    const clusters: ContextNode[][] = [];

    for (const snapshot of eligible) {
      if (visited.has(snapshot.id)) continue;
      visited.add(snapshot.id);

      const cluster = [snapshot];
      const currentEmbedding = embeddings.get(snapshot.id);
      if (!currentEmbedding) continue;

      for (const candidate of eligible) {
        if (candidate.id === snapshot.id || visited.has(candidate.id)) continue;
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

    const resultClusters: SummaryCompressionResult['clusters'] = [];
    for (const cluster of clusters) {
      const summaryNode = this.graphStore.createNode({
        substrateType: SubstrateType.SUMMARY,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: buildSummaryTitle(cluster),
        content: buildSummaryContent(cluster),
        tags: ['session-summary', 'summary-compression'],
        project: cluster[0].project,
        compressionLevel: 0.08,
        confidence: 0.75,
        qualityScore: 75,
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          sourceSnapshotIds: cluster.map((item) => item.id),
          clusterSize: cluster.length,
        },
      });

      for (const snapshot of cluster) {
        this.graphStore.createEdge({
          sourceId: snapshot.id,
          targetId: summaryNode.id,
          relationType: ContextRelationType.GENERALIZES,
          strength: 1,
          evidence: { sourceSnapshotId: snapshot.id },
        });
      }

      resultClusters.push({
        summaryNodeId: summaryNode.id,
        sourceSnapshotIds: cluster.map((item) => item.id),
      });
    }

    return {
      scannedSnapshots: eligible.length,
      summaryNodesCreated: resultClusters.length,
      clusters: resultClusters,
    };
  }

  private hasSummaryParent(snapshotId: string): boolean {
    return this.graphStore.listOutgoingEdges(snapshotId).some((edge) => {
      if (edge.relationType !== ContextRelationType.GENERALIZES) return false;
      const target = this.graphStore.getNodeById(edge.targetId);
      return target?.substrateType === SubstrateType.SUMMARY;
    });
  }
}

function buildSummaryTitle(cluster: ContextNode[]): string {
  const project = cluster[0].project || 'default';
  return `Session summary cluster: ${project} (${cluster.length} snapshots)`;
}

function buildSummaryContent(cluster: ContextNode[]): string {
  const bullets = cluster.map((snapshot, index) => {
    const firstLine = snapshot.content.split('\n')[0] ?? snapshot.title;
    return `${index + 1}. ${snapshot.title}\n${firstLine}`;
  });

  return [
    `Compressed from ${cluster.length} similar session snapshots.`,
    '',
    ...bullets,
  ].join('\n');
}
