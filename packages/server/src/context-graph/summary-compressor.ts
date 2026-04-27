import { Embedder } from '../processing/embedder.js';
import { clusterContextNodes, hasGeneralizationParent } from './context-clustering.js';
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

    const eligible = snapshots.filter((snapshot) => (
      !hasGeneralizationParent(this.graphStore, snapshot.id, SubstrateType.SUMMARY)
    ));
    const clusters = await clusterContextNodes({
      nodes: eligible,
      embedder: this.embedder,
      minClusterSize,
      similarityThreshold,
    });

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
