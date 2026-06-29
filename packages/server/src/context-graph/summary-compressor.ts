import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { runSubstrateCompression } from './substrate-compression.js';
import { synthesizeCompressedNode } from './compression-llm-synthesis.js';
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
    const providers = this.providerFactory.forProject(options.project ?? '');
    const embedder = providers.embedder;
    // Only form summaries when we can synthesize with an LLM; offline/no-LLM
    // skips rather than emitting "Compressed from N snapshots" template shells.
    const llmClient = await providers.llmClientPromise;
    if (embedder.isLocalMode() || !llmClient) {
      return { scannedSnapshots: 0, summaryNodesCreated: 0, clusters: [] };
    }
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
      requireIntraClusterCohesion: true,
      synthesize: (cluster) => synthesizeCompressedNode({
        client: llmClient,
        model: providers.llmModel,
        targetType: SubstrateType.SUMMARY,
        cluster,
      }),
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

const buildSummaryContent = (cluster: ContextNode[]): string =>
  `Compressed from ${cluster.length} session snapshot(s).`;
