import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { runSubstrateCompression } from './substrate-compression.js';
import { synthesizeCompressedNode } from './compression-llm-synthesis.js';
import {
  ContextDomainType,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';

export interface RuleCompressionOptions {
  project?: string;
  minClusterSize?: number;
  minPositiveFeedback?: number;
  similarityThreshold?: number;
  limit?: number;
}

export interface RuleCompressionResult {
  scannedPatterns: number;
  ruleNodesCreated: number;
  clusters: Array<{
    ruleNodeId: string;
    sourcePatternIds: string[];
  }>;
}

export class RuleCompressor {
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async compressProjectPatterns(
    options: RuleCompressionOptions = {},
  ): Promise<RuleCompressionResult> {
    const providers = this.providerFactory.forProject(options.project ?? '');
    const embedder = providers.embedder;
    // A RULE shapes future retrieval and is template-noise without real
    // synthesis (unrelated patterns fused into one shell). Only form rules when
    // we can cluster on real vectors and synthesize with an LLM; offline/no-LLM
    // skips entirely rather than emitting "Generalized from N patterns" shells.
    const llmClient = await providers.llmClientPromise;
    if (embedder.isLocalMode() || !llmClient) {
      return { scannedPatterns: 0, ruleNodesCreated: 0, clusters: [] };
    }
    // Default of 2 positive feedback (was 4): a PATTERN with at least
    // two `adopted` signals is a credible RULE candidate. Four was
    // calibrated for team-server multi-user mode where many agents
    // collectively reinforce the same pattern; for single-user local
    // use it made the lineage stall at PATTERN forever.
    const minPositiveFeedback = options.minPositiveFeedback ?? 2;
    const run = await runSubstrateCompression(this.graphStore, embedder, {
      sourceType: SubstrateType.PATTERN,
      sourceDomain: ContextDomainType.PATTERN,
      targetType: SubstrateType.RULE,
      targetDomain: ContextDomainType.CONVENTION,
      tags: ['rule-compression', 'session-rule'],
      compressionLevel: 0.01,
      confidence: 0.85,
      qualityScore: 85,
      defaultSimilarityThreshold: 0.88,
      // Require cluster-wide cohesion, not just seed similarity, so loosely
      // related patterns can't accrete into one bogus rule.
      requireIntraClusterCohesion: true,
      // LLM synthesis is the title/content source; null skips the cluster so a
      // spurious grouping never becomes a rule. Template fns kept for the type
      // contract but synthesize overrides them on success.
      synthesize: (cluster) => synthesizeCompressedNode({
        client: llmClient,
        model: providers.llmModel,
        targetType: SubstrateType.RULE,
        cluster,
      }),
      title: buildRuleTitle,
      content: buildRuleContent,
      metadata: (cluster) => ({
        sourcePatternIds: cluster.map((item) => item.id),
        promotionReason: cluster.length === 1 ? 'high_positive_feedback' : 'similarity_cluster',
      }),
      evidence: (pattern) => ({ sourcePatternId: pattern.id }),
      promoteSingleton: (pattern) => (
        pattern.positiveFeedback >= minPositiveFeedback && pattern.positiveFeedback > pattern.negativeFeedback
      ),
    }, options);

    return {
      scannedPatterns: run.scannedNodes,
      ruleNodesCreated: run.clusters.length,
      clusters: run.clusters.map(({ targetNode, sourceNodes }) => ({
        ruleNodeId: targetNode.id,
        sourcePatternIds: sourceNodes.map((item) => item.id),
      })),
    };
  }
}

const buildRuleTitle = (cluster: ContextNode[]): string => {
  const project = cluster[0].project || 'default';
  return `Session rule: ${project} (${cluster.length} patterns)`;
};

const buildRuleContent = (cluster: ContextNode[]): string =>
  `Generalized from ${cluster.length} session pattern(s).`;
