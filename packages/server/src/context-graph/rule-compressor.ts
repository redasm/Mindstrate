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
  private readonly graphStore: ContextGraphStore;
  private readonly embedder: Embedder;

  constructor(graphStore: ContextGraphStore, embedder: Embedder) {
    this.graphStore = graphStore;
    this.embedder = embedder;
  }

  async compressProjectPatterns(
    options: RuleCompressionOptions = {},
  ): Promise<RuleCompressionResult> {
    const minClusterSize = options.minClusterSize ?? 2;
    const minPositiveFeedback = options.minPositiveFeedback ?? 4;
    const similarityThreshold = options.similarityThreshold ?? 0.88;
    const limit = options.limit ?? 200;

    const patterns = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      limit,
    });

    const eligible = patterns.filter((pattern) => (
      !hasGeneralizationParent(this.graphStore, pattern.id, SubstrateType.RULE)
    ));
    const clusters = await clusterContextNodes({
      nodes: eligible,
      embedder: this.embedder,
      minClusterSize,
      similarityThreshold,
      promoteSingleton: (pattern) => (
        pattern.positiveFeedback >= minPositiveFeedback && pattern.positiveFeedback > pattern.negativeFeedback
      ),
    });

    const resultClusters: RuleCompressionResult['clusters'] = [];
    for (const cluster of clusters) {
      const ruleNode = this.graphStore.createNode({
        substrateType: SubstrateType.RULE,
        domainType: ContextDomainType.CONVENTION,
        title: buildRuleTitle(cluster),
        content: buildRuleContent(cluster),
        tags: ['rule-compression', 'session-rule'],
        project: cluster[0].project,
        compressionLevel: 0.01,
        confidence: 0.85,
        qualityScore: 85,
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          sourcePatternIds: cluster.map((item) => item.id),
          clusterSize: cluster.length,
          promotionReason: cluster.length === 1 ? 'high_positive_feedback' : 'similarity_cluster',
        },
      });

      for (const pattern of cluster) {
        this.graphStore.createEdge({
          sourceId: pattern.id,
          targetId: ruleNode.id,
          relationType: ContextRelationType.GENERALIZES,
          strength: 1,
          evidence: { sourcePatternId: pattern.id },
        });
      }

      resultClusters.push({
        ruleNodeId: ruleNode.id,
        sourcePatternIds: cluster.map((item) => item.id),
      });
    }

    return {
      scannedPatterns: eligible.length,
      ruleNodesCreated: resultClusters.length,
      clusters: resultClusters,
    };
  }
}

function buildRuleTitle(cluster: ContextNode[]): string {
  const project = cluster[0].project || 'default';
  return `Session rule: ${project} (${cluster.length} patterns)`;
}

function buildRuleContent(cluster: ContextNode[]): string {
  const bullets = cluster.map((pattern, index) => {
    const firstLine = pattern.content.split('\n')[0] ?? pattern.title;
    return `${index + 1}. ${pattern.title}\n${firstLine}`;
  });

  return [
    `Generalized from ${cluster.length} highly similar session patterns.`,
    '',
    ...bullets,
  ].join('\n');
}
