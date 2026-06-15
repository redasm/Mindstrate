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

  /**
   * Permanently delete a project: its vectors, its context-graph rows
   * (nodes/edges/embeddings/projections/events/conflicts/metabolism), and its
   * scan-source configs so it isn't rebuilt on the next scan. Each step is
   * idempotent, so a partial failure can be retried safely. Irreversible.
   */
  async deleteProject(project: string): Promise<{ nodesDeleted: number; sourcesDeleted: number }> {
    await this.services.vectorStoreFactory.deleteProject(project);
    const { nodesDeleted } = this.services.contextGraphStore.deleteProject(project);
    let sourcesDeleted = 0;
    for (const source of this.services.scanSourceRepository.listSources()) {
      if (source.project.toLowerCase() === project.toLowerCase()) {
        if (this.services.scanSourceRepository.deleteSource(source.id)) sourcesDeleted++;
      }
    }
    return { nodesDeleted, sourcesDeleted };
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

