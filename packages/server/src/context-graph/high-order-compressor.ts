import type { Embedder } from '../processing/embedder.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { buildClusterContent, runSubstrateCompression } from './substrate-compression.js';
import {
  ContextDomainType,
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
    const run = await runSubstrateCompression(this.graphStore, this.embedder, {
      sourceType: spec.sourceType,
      targetType: spec.targetType,
      targetDomain: spec.targetDomain,
      tags: [spec.tag, 'high-order-compression'],
      compressionLevel: spec.compressionLevel,
      confidence: spec.confidence,
      qualityScore: spec.qualityScore,
      defaultSimilarityThreshold: 0.82,
      title: (cluster) => buildTitle(spec.targetType, cluster),
      content: (cluster) => buildContent(spec.targetType, cluster),
      metadata: (cluster) => ({
        sourceNodeIds: cluster.map((item) => item.id),
        sourceSubstrateType: spec.sourceType,
      }),
      evidence: (source) => ({
        sourceNodeId: source.id,
        sourceSubstrateType: spec.sourceType,
        targetSubstrateType: spec.targetType,
      }),
    }, options);

    return {
      scannedNodes: run.scannedNodes,
      nodesCreated: run.clusters.length,
      clusters: run.clusters.map(({ targetNode, sourceNodes }) => ({
        targetNodeId: targetNode.id,
        sourceNodeIds: sourceNodes.map((item) => item.id),
      })),
    };
  }
}

const buildTitle = (targetType: SubstrateType, cluster: ContextNode[]): string => {
  const project = cluster[0].project || 'default';
  return `${targetType} cluster: ${project} (${cluster.length} nodes)`;
};

const buildContent = (targetType: SubstrateType, cluster: ContextNode[]): string => buildClusterContent(
  `Generalized ${targetType} from ${cluster.length} related ${cluster[0].substrateType} nodes.`,
  cluster,
);
