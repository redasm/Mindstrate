import { cosineSimilarity } from '../processing/vector-distance.js';
import type { Embedder } from '../processing/embedder.js';
import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextRelationType,
  type ContextNode,
  type SubstrateType,
} from '@mindstrate/protocol/models';

export interface ContextClusterOptions {
  nodes: ContextNode[];
  embedder: Embedder;
  minClusterSize: number;
  similarityThreshold: number;
  promoteSingleton?: (node: ContextNode) => boolean;
  /**
   * Require a candidate to be similar to the cluster's existing members on
   * average — not just to the seed. The default greedy single-link pass admits
   * anything close to the seed, so a cluster can collect members that resemble
   * the seed but not each other (e.g. unrelated refactors that share a few
   * generic tokens). With this on, a candidate joins only if its mean
   * similarity to current members also clears the threshold.
   */
  requireIntraClusterCohesion?: boolean;
  similarity?: (input: {
    node: ContextNode;
    candidate: ContextNode;
    nodeEmbedding: number[];
    candidateEmbedding: number[];
  }) => number;
}

export async function clusterContextNodes({
  nodes,
  embedder,
  minClusterSize,
  similarityThreshold,
  promoteSingleton,
  requireIntraClusterCohesion = false,
  similarity = ({ nodeEmbedding, candidateEmbedding }) => cosineSimilarity(nodeEmbedding, candidateEmbedding),
}: ContextClusterOptions): Promise<ContextNode[][]> {
  const embeddings = new Map<string, number[]>();
  for (const node of nodes) {
    embeddings.set(node.id, await embedder.embed(node.content));
  }

  const visited = new Set<string>();
  const clusters: ContextNode[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);

    const nodeEmbedding = embeddings.get(node.id);
    if (!nodeEmbedding) continue;

    const cluster = [node];
    for (const candidate of nodes) {
      if (candidate.id === node.id || visited.has(candidate.id)) continue;

      const candidateEmbedding = embeddings.get(candidate.id);
      if (!candidateEmbedding) continue;

      const score = similarity({
        node,
        candidate,
        nodeEmbedding,
        candidateEmbedding,
      });
      if (score < similarityThreshold) continue;

      // Cohesion guard: the candidate must also fit the cluster as a whole,
      // not merely the seed, so loosely-related members can't accrete.
      if (requireIntraClusterCohesion && cluster.length > 1) {
        const meanToMembers = cluster.reduce((sum, member) => {
          const memberEmbedding = embeddings.get(member.id);
          if (!memberEmbedding) return sum;
          return sum + similarity({
            node: member,
            candidate,
            nodeEmbedding: memberEmbedding,
            candidateEmbedding,
          });
        }, 0) / cluster.length;
        if (meanToMembers < similarityThreshold) continue;
      }

      visited.add(candidate.id);
      cluster.push(candidate);
    }

    if (cluster.length >= minClusterSize) {
      clusters.push(cluster);
    } else if (promoteSingleton?.(node)) {
      clusters.push([node]);
    }
  }

  return clusters;
}

export function hasGeneralizationParent(
  graphStore: ContextGraphStore,
  nodeId: string,
  targetType: SubstrateType,
): boolean {
  return graphStore.listOutgoingEdges(nodeId).some((edge) => {
    if (edge.relationType !== ContextRelationType.GENERALIZES) return false;
    return graphStore.getNodeById(edge.targetId)?.substrateType === targetType;
  });
}

export function lexicalOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let matches = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) matches++;
  }
  return matches / Math.min(aTokens.size, bTokens.size);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((token) => token.length > 2);
}
