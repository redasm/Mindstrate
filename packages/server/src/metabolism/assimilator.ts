import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  MetabolismStage,
  SubstrateType,
  type ContextNode,
  type MetabolismStageStats,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { MetabolismStageOptions } from './metabolism-engine.js';

const groupEpisodesBySource = (episodes: ContextNode[]): Map<string, ContextNode[]> => {
  const groups = new Map<string, ContextNode[]>();
  for (const episode of episodes) {
    const sourceRef = episode.sourceRef ?? episode.metadata?.['sessionId'];
    if (typeof sourceRef !== 'string' || sourceRef.length === 0) continue;
    const current = groups.get(sourceRef) ?? [];
    current.push(episode);
    groups.set(sourceRef, current);
  }
  return groups;
};

export class Assimilator {
  constructor(private readonly graphStore: ContextGraphStore) {}

  run(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.ASSIMILATE } {
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });
    const groups = groupEpisodesBySource(episodes);
    let created = 0;
    let skipped = 0;

    for (const [sourceRef, sourceEpisodes] of groups) {
      const existing = this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.SNAPSHOT,
        sourceRef,
        limit: 1,
      })[0];
      if (existing) {
        skipped += sourceEpisodes.length;
        continue;
      }

      const snapshot = this.graphStore.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: `Assimilated snapshot: ${sourceRef}`,
        content: sourceEpisodes.map((episode) => episode.content).join('\n\n'),
        tags: ['assimilated-snapshot'],
        project: options.project ?? sourceEpisodes[0]?.project,
        compressionLevel: 0.2,
        confidence: 0.75,
        qualityScore: 60,
        status: ContextNodeStatus.ACTIVE,
        sourceRef,
        metadata: {
          episodeIds: sourceEpisodes.map((episode) => episode.id),
        },
      });

      for (const episode of sourceEpisodes) {
        this.graphStore.createEdge({
          sourceId: episode.id,
          targetId: snapshot.id,
          relationType: ContextRelationType.DERIVED_FROM,
          strength: 1,
          evidence: { sourceRef },
        });
      }
      created++;
    }

    return {
      stage: MetabolismStage.ASSIMILATE,
      scanned: episodes.length,
      created,
      updated: 0,
      skipped,
    };
  }
}
