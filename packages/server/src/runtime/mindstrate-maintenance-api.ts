import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateMaintenanceApi {
  constructor(private readonly services: MindstrateRuntime) {}

  runMaintenance(): {
    total: number;
    updated: number;
    outdated: number;
  } {
    return {
      total: this.services.contextGraphStore.countNodes(),
      updated: 0,
      outdated: 0,
    };
  }

  /**
   * Per-project rollup for dashboards (entry count, conflicted count, latest
   * activity), computed in SQL so the caller never materializes the whole graph.
   */
  getProjectBreakdown(): Array<{ project: string; entries: number; conflicts: number; lastActivity: string | null }> {
    return this.services.contextGraphStore.getProjectBreakdown();
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
    const dbStats = this.services.contextGraphStore.getGraphStats();
    const projects = this.services.contextGraphStore.listKnownProjects();
    let vectorCount = 0;
    for (const project of projects) {
      const store = await this.services.vectorStoreFactory.forProject(project);
      vectorCount += await store.count();
    }
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

