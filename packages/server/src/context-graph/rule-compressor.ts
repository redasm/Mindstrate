import type { Embedder } from '../processing/embedder.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { buildClusterContent, runSubstrateCompression } from './substrate-compression.js';
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
    private readonly embedder: Embedder,
  ) {}

  async compressProjectPatterns(
    options: RuleCompressionOptions = {},
  ): Promise<RuleCompressionResult> {
    const minPositiveFeedback = options.minPositiveFeedback ?? 4;
    const run = await runSubstrateCompression(this.graphStore, this.embedder, {
      sourceType: SubstrateType.PATTERN,
      sourceDomain: ContextDomainType.PATTERN,
      targetType: SubstrateType.RULE,
      targetDomain: ContextDomainType.CONVENTION,
      tags: ['rule-compression', 'session-rule'],
      compressionLevel: 0.01,
      confidence: 0.85,
      qualityScore: 85,
      defaultSimilarityThreshold: 0.88,
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

const buildRuleContent = (cluster: ContextNode[]): string => buildClusterContent(
  `Generalized from ${cluster.length} highly similar session patterns.`,
  cluster,
);
