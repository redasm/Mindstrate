import {
  MetabolismStage,
  SubstrateType,
  type MetabolismStageStats,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { MetabolismStageOptions } from './metabolism-engine.js';

export class DigestEngine {
  constructor(private readonly graphStore: ContextGraphStore) {}

  run(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.DIGEST } {
    const events = this.graphStore.listEvents({
      project: options.project,
      limit: 1000,
    });
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });

    return {
      stage: MetabolismStage.DIGEST,
      scanned: events.length,
      created: episodes.length,
      updated: 0,
      skipped: Math.max(events.length - episodes.length, 0),
    };
  }
}
