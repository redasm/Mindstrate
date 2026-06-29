import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from './context-graph-store.js';
import { runSubstrateCompression } from './substrate-compression.js';
import { synthesizeHighOrderNode } from './high-order-llm-synthesis.js';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
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
    private readonly providerFactory: ProviderFactory,
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
    const providers = this.providerFactory.forProject(options.project ?? '');

    // High-order substrates (skill / heuristic / axiom) shape future context
    // assembly and are hard to walk back, so they're only worth forming when
    // we can (a) cluster on real semantic vectors and (b) actually synthesize
    // a generalization. Offline hash embeddings produce spurious clusters
    // (token-overlap, not meaning) and without an LLM we'd only emit template
    // placeholders — so skip entirely rather than generate noise.
    const llmClient = await providers.llmClientPromise;
    if (providers.embedder.isLocalMode() || !llmClient) {
      return { scannedNodes: 0, nodesCreated: 0, clusters: [] };
    }

    const run = await runSubstrateCompression(this.graphStore, providers.embedder, {
      sourceType: spec.sourceType,
      targetType: spec.targetType,
      targetDomain: spec.targetDomain,
      tags: [spec.tag, 'high-order-compression'],
      compressionLevel: spec.compressionLevel,
      confidence: spec.confidence,
      qualityScore: spec.qualityScore,
      // Higher bar than mid-tier compression: a wrong high-order promotion is
      // costly, so demand tighter similarity and full cluster cohesion.
      defaultSimilarityThreshold: 0.88,
      requireIntraClusterCohesion: true,
      // Candidate-first: high-order substrates are never auto-promoted to
      // active by the compressor. They enter as `candidate` and only the
      // SkillOpt-style evaluation gate (or an explicit human accept) can move
      // them to active / verified.
      targetStatus: ContextNodeStatus.CANDIDATE,
      // LLM synthesis is the title/content source; null skips the cluster so a
      // spurious grouping never becomes a node.
      synthesize: (cluster) => synthesizeHighOrderNode({
        client: llmClient,
        model: providers.llmModel,
        targetType: spec.targetType,
        cluster,
      }),
      // Kept for the type contract, but synthesize overrides these on success.
      title: (cluster) => `${spec.targetType} cluster (${cluster.length})`,
      content: (cluster) => `Generalized ${spec.targetType} from ${cluster.length} nodes.`,
      metadata: (cluster) => ({
        sourceNodeIds: cluster.map((item) => item.id),
        sourceSubstrateType: spec.sourceType,
      }),
      evidence: (source) => ({
        sourceNodeId: source.id,
        sourceSubstrateType: spec.sourceType,
        targetSubstrateType: spec.targetType,
      }),
      // No singleton promotion for high-order: a generalization needs at least
      // a real cluster to synthesize from. minClusterSize default below is 3.
    }, { ...options, minClusterSize: options.minClusterSize ?? 3 });

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
