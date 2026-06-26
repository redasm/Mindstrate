import type { MindstrateRuntime } from './mindstrate-runtime.js';
import { backfillNodeEmbeddings } from '../context-graph/node-embedding-backfill.js';

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
   * Remove template-placeholder high-order compression nodes (CANDIDATE
   * skill/heuristic/axiom whose content is the old "Generalized ... from N
   * nodes" template, not an LLM synthesis). Cleans up noise produced before
   * high-order compression required real LLM generalization.
   */
  pruneTemplateHighOrderNodes(project?: string): { nodesDeleted: number } {
    return this.services.contextGraphStore.deleteTemplateHighOrderNodes(project);
  }

  /**
   * Permanently delete a project: its context-graph rows
   * (nodes/edges/embeddings/projections/events/conflicts/metabolism), its
   * scan-source configs (so it isn't rebuilt on the next scan), and its
   * vectors. Irreversible.
   *
   * The durable SQLite data is deleted first — that's what makes the project
   * disappear from the UI. The vector index is a file that may be owned by a
   * different container user (the scanner runs as root, web-ui/team-server as
   * uid 1001), so a permission error clearing it must NOT abort the deletion;
   * it's reported via `vectorsCleared: false` instead.
   */
  async deleteProject(project: string): Promise<{ nodesDeleted: number; sourcesDeleted: number; vectorsCleared: boolean }> {
    const { nodesDeleted } = this.services.contextGraphStore.deleteProject(project);
    let sourcesDeleted = 0;
    for (const source of this.services.scanSourceRepository.listSources()) {
      if (source.project.toLowerCase() === project.toLowerCase()) {
        if (this.services.scanSourceRepository.deleteSource(source.id)) sourcesDeleted++;
      }
    }
    let vectorsCleared = true;
    try {
      await this.services.vectorStoreFactory.deleteProject(project);
    } catch (error) {
      vectorsCleared = false;
      this.services.logger.warn(
        `Deleted project "${project}" graph + sources, but could not clear its vector index `
          + `(likely a cross-container file-ownership issue): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { nodesDeleted, sourcesDeleted, vectorsCleared };
  }

  /**
   * Rebuild node embeddings for one project (or all known projects). Clears
   * the project's stored node embeddings, then re-embeds every live node with
   * the project's currently configured embedding model. This is the fix for
   * embedding-dimension drift: switching a project's LLM Config embedding
   * model leaves the old-dimension vectors unusable (cosine across dimensions
   * is undefined), and this re-aligns everything to the new model. Idempotent.
   */
  async rebuildVectors(
    project?: string,
    onProgress?: (p: { project: string; embedded: number; total: number }) => void,
  ): Promise<Array<{ project: string; embedded: number; candidates: number; model: string; dimensions: number }>> {
    const projects = project
      ? [project]
      : this.services.contextGraphStore.listKnownProjects();
    const results: Array<{ project: string; embedded: number; candidates: number; model: string; dimensions: number }> = [];
    for (const name of projects) {
      this.services.contextGraphStore.deleteNodeEmbeddingsForProject(name);
      const providers = this.services.providerFactory.forProject(name);
      const result = await backfillNodeEmbeddings(
        this.services.contextGraphStore,
        providers.embedder,
        providers.embeddingModel,
        {
          project: name,
          force: true,
          onProgress: (p) => onProgress?.({ project: name, embedded: p.embedded, total: p.total }),
        },
      );
      results.push({
        project: name,
        embedded: result.embedded,
        candidates: result.candidates,
        model: result.model,
        dimensions: result.dimensions,
      });
    }
    return results;
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

