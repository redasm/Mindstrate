import { describe, expect, it } from 'vitest';
import { ContextDomainType, ContextNodeStatus, SubstrateType, type ContextNode } from '@mindstrate/protocol/models';
import { clusterContextNodes } from '../src/context-graph/context-clustering.js';
import type { Embedder } from '../src/processing/embedder.js';

// Minimal embedder stub: returns a per-node vector keyed by the node content,
// so the test fully controls pairwise similarity.
const vectorsByContent: Record<string, number[]> = {
  A: [1, 0, 0],
  B: [0.7, 0.71, 0],  // ~0.70 to seed A
  C: [0.7, -0.71, 0], // ~0.70 to seed A, but nearly opposite to B
};
const stubEmbedder = {
  embed: async (text: string) => vectorsByContent[text] ?? [0, 0, 1],
} as unknown as Embedder;

const node = (id: string, content: string): ContextNode => ({
  id,
  substrateType: SubstrateType.RULE,
  domainType: ContextDomainType.CONVENTION,
  title: id,
  content,
  tags: [],
  project: 'demo',
  compressionLevel: 1,
  confidence: 0.8,
  qualityScore: 70,
  status: ContextNodeStatus.ACTIVE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  accessCount: 0,
  positiveFeedback: 0,
  negativeFeedback: 0,
});

describe('clusterContextNodes intra-cluster cohesion', () => {
  const nodes = [node('a', 'A'), node('b', 'B'), node('c', 'C')];

  it('without cohesion, admits a member that only resembles the seed', async () => {
    const clusters = await clusterContextNodes({
      nodes,
      embedder: stubEmbedder,
      minClusterSize: 2,
      similarityThreshold: 0.69,
    });
    // C joins because it clears 0.69 vs the seed A, even though it's far from B.
    expect(clusters[0].map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('with cohesion, rejects a member that does not fit the cluster as a whole', async () => {
    const clusters = await clusterContextNodes({
      nodes,
      embedder: stubEmbedder,
      minClusterSize: 2,
      similarityThreshold: 0.69,
      requireIntraClusterCohesion: true,
    });
    // C is dropped: its mean similarity to {A,B} falls below threshold once B is in.
    expect(clusters[0].map((n) => n.id).sort()).toEqual(['a', 'b']);
  });
});
