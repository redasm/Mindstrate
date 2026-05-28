import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { buildClusterContent, runSubstrateCompression } from './substrate-compression.js';
import {
  ContextDomainType,
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
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async compressProjectSnapshots(
    options: SummaryCompressionOptions = {},
  ): Promise<SummaryCompressionResult> {
    const embedder = this.providerFactory.forProject(options.project ?? '').embedder;
    const run = await runSubstrateCompression(this.graphStore, embedder, {
      sourceType: SubstrateType.SNAPSHOT,
      sourceDomain: ContextDomainType.SESSION_SUMMARY,
      targetType: SubstrateType.SUMMARY,
      targetDomain: ContextDomainType.SESSION_SUMMARY,
      tags: ['session-summary', 'summary-compression'],
      compressionLevel: 0.08,
      confidence: 0.75,
      qualityScore: 75,
      defaultSimilarityThreshold: 0.78,
      title: buildSummaryTitle,
      content: buildSummaryContent,
      metadata: (cluster) => ({ sourceSnapshotIds: cluster.map((item) => item.id) }),
      evidence: (snapshot) => ({ sourceSnapshotId: snapshot.id }),
      // Promote a quality-verified single snapshot into a SUMMARY when
      // no peer cluster exists yet. Without this, a solo user with one
      // active project would never see memory "mature" out of the
      // SNAPSHOT layer no matter how much they used the system —
      // clustering requires at least two similar snapshots which the
      // happy-path workflow rarely produces in a single session. The
      // qualityScore >= 70 guard keeps low-quality scratch snapshots
      // out of the SUMMARY layer.
      promoteSingleton: (node) => node.qualityScore >= 70,
    }, options);

    return {
      scannedSnapshots: run.scannedNodes,
      summaryNodesCreated: run.clusters.length,
      clusters: run.clusters.map(({ targetNode, sourceNodes }) => ({
        summaryNodeId: targetNode.id,
        sourceSnapshotIds: sourceNodes.map((item) => item.id),
      })),
    };
  }
}

const buildSummaryTitle = (cluster: ContextNode[]): string => {
  const project = cluster[0].project || 'default';
  return `Session summary cluster: ${project} (${cluster.length} snapshots)`;
};

const buildSummaryContent = (cluster: ContextNode[]): string => buildClusterContent(
  `Compressed from ${cluster.length} similar session snapshots.`,
  cluster,
);
