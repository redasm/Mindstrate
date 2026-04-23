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

export interface RuleCompressionOptions {
  project?: string;
  minClusterSize?: number;
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
    const similarityThreshold = options.similarityThreshold ?? 0.88;
    const limit = options.limit ?? 200;

    const patterns = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.PATTERN,
      limit,
    });

    const eligible = patterns.filter((pattern) => !this.hasRuleParent(pattern.id));
    const embeddings = new Map<string, number[]>();
    for (const pattern of eligible) {
      embeddings.set(pattern.id, await this.embedder.embed(pattern.content));
    }

    const visited = new Set<string>();
    const clusters: ContextNode[][] = [];

    for (const pattern of eligible) {
      if (visited.has(pattern.id)) continue;
      visited.add(pattern.id);

      const cluster = [pattern];
      const currentEmbedding = embeddings.get(pattern.id);
      if (!currentEmbedding) continue;

      for (const candidate of eligible) {
        if (candidate.id === pattern.id || visited.has(candidate.id)) continue;
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

  private hasRuleParent(patternId: string): boolean {
    return this.graphStore.listOutgoingEdges(patternId).some((edge) => {
      if (edge.relationType !== ContextRelationType.GENERALIZES) return false;
      const target = this.graphStore.getNodeById(edge.targetId);
      return target?.substrateType === SubstrateType.RULE;
    });
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
