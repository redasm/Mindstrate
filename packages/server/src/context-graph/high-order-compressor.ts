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

export interface HighOrderCompressionOptions {
  project?: string;
  minClusterSize?: number;
  similarityThreshold?: number;
  limit?: number;
}

export interface HighOrderCompressionResult {
  scannedNodes: number;
  nodesCreated: number;
  clusters: Array<{
    targetNodeId: string;
    sourceNodeIds: string[];
  }>;
}

interface UpgradeSpec {
  sourceType: SubstrateType;
  targetType: SubstrateType;
  targetDomain: ContextDomainType;
  tag: string;
  compressionLevel: number;
  confidence: number;
  qualityScore: number;
}

export class HighOrderCompressor {
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly embedder: Embedder,
  ) {}

  compressRulesToSkills(options: HighOrderCompressionOptions = {}): Promise<HighOrderCompressionResult> {
    return this.compress(options, {
      sourceType: SubstrateType.RULE,
      targetType: SubstrateType.SKILL,
      targetDomain: ContextDomainType.WORKFLOW,
      tag: 'skill-compression',
      compressionLevel: 0.005,
      confidence: 0.82,
      qualityScore: 86,
    });
  }

  compressSkillsToHeuristics(options: HighOrderCompressionOptions = {}): Promise<HighOrderCompressionResult> {
    return this.compress(options, {
      sourceType: SubstrateType.SKILL,
      targetType: SubstrateType.HEURISTIC,
      targetDomain: ContextDomainType.BEST_PRACTICE,
      tag: 'heuristic-compression',
      compressionLevel: 0.002,
      confidence: 0.86,
      qualityScore: 90,
    });
  }

  compressHeuristicsToAxioms(options: HighOrderCompressionOptions = {}): Promise<HighOrderCompressionResult> {
    return this.compress(options, {
      sourceType: SubstrateType.HEURISTIC,
      targetType: SubstrateType.AXIOM,
      targetDomain: ContextDomainType.BEST_PRACTICE,
      tag: 'axiom-compression',
      compressionLevel: 0.001,
      confidence: 0.9,
      qualityScore: 94,
    });
  }

  private async compress(
    options: HighOrderCompressionOptions,
    spec: UpgradeSpec,
  ): Promise<HighOrderCompressionResult> {
    const minClusterSize = options.minClusterSize ?? 2;
    const similarityThreshold = options.similarityThreshold ?? 0.82;
    const limit = options.limit ?? 200;
    const nodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: spec.sourceType,
      limit,
    });
    const eligible = nodes.filter((node) => !hasGeneralizationParent(this.graphStore, node.id, spec.targetType));
    const clusters = await clusterContextNodes({
      nodes: eligible,
      embedder: this.embedder,
      minClusterSize,
      similarityThreshold,
    });
    const resultClusters: HighOrderCompressionResult['clusters'] = [];

    for (const cluster of clusters) {
      const targetNode = this.graphStore.createNode({
        substrateType: spec.targetType,
        domainType: spec.targetDomain,
        title: buildTitle(spec.targetType, cluster),
        content: buildContent(spec.targetType, cluster),
        tags: [spec.tag, 'high-order-compression'],
        project: cluster[0].project,
        compressionLevel: spec.compressionLevel,
        confidence: spec.confidence,
        qualityScore: spec.qualityScore,
        status: ContextNodeStatus.ACTIVE,
        metadata: {
          sourceNodeIds: cluster.map((item) => item.id),
          sourceSubstrateType: spec.sourceType,
          clusterSize: cluster.length,
        },
      });

      for (const source of cluster) {
        this.graphStore.createEdge({
          sourceId: source.id,
          targetId: targetNode.id,
          relationType: ContextRelationType.GENERALIZES,
          strength: 1,
          evidence: {
            sourceNodeId: source.id,
            sourceSubstrateType: spec.sourceType,
            targetSubstrateType: spec.targetType,
          },
        });
      }

      resultClusters.push({
        targetNodeId: targetNode.id,
        sourceNodeIds: cluster.map((item) => item.id),
      });
    }

    return {
      scannedNodes: eligible.length,
      nodesCreated: resultClusters.length,
      clusters: resultClusters,
    };
  }
}

const buildTitle = (targetType: SubstrateType, cluster: ContextNode[]): string => {
  const project = cluster[0].project || 'default';
  return `${targetType} cluster: ${project} (${cluster.length} nodes)`;
};

const buildContent = (targetType: SubstrateType, cluster: ContextNode[]): string => [
  `Generalized ${targetType} from ${cluster.length} related ${cluster[0].substrateType} nodes.`,
  '',
  ...cluster.map((node, index) => `${index + 1}. ${node.title}\n${node.content.split('\n')[0] ?? node.content}`),
].join('\n');
