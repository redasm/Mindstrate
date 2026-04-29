import { getGraphStats } from '../context-graph/graph-stats.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateMaintenanceApi {
  constructor(private readonly services: MindstrateRuntime) {}

  runMaintenance(): {
    total: number;
    updated: number;
    outdated: number;
  } {
    return {
      total: this.services.contextGraphStore.listNodes({ limit: 100000 }).length,
      updated: 0,
      outdated: 0,
    };
  }

  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
    vectorCount: number;
    feedbackStats: {
      totalEvents: number;
      last30Days: number;
      avgAdoptionRate: number;
    };
  }> {
    const nodes = this.services.contextGraphStore.listNodes({ limit: 100000 });
    const dbStats = getGraphStats(nodes);
    const vectorCount = await this.services.vectorStore.count();
    const feedbackStats = this.services.feedbackLoop.getGlobalStats();

    return {
      ...dbStats,
      vectorCount,
      feedbackStats: {
        totalEvents: feedbackStats.totalEvents,
        last30Days: feedbackStats.last30Days,
        avgAdoptionRate: feedbackStats.avgAdoptionRate,
      },
    };
  }
}

