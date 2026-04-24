import { ProjectionTarget } from '@mindstrate/protocol/models';
import type { ProjectionRecord } from '@mindstrate/protocol/models';
import { GraphKnowledgeProjector, type GraphKnowledgeProjectionOptions } from '../context-graph/knowledge-projector.js';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export class KnowledgeProjectionMaterializer {
  private readonly graphStore: ContextGraphStore;
  private readonly projector: GraphKnowledgeProjector;

  constructor(graphStore: ContextGraphStore, projector: GraphKnowledgeProjector) {
    this.graphStore = graphStore;
    this.projector = projector;
  }

  materialize(options: GraphKnowledgeProjectionOptions = {}): ProjectionRecord[] {
    const projected = this.projector.project({
      ...options,
      limit: options.limit ?? 50,
    });

    return projected.map((view, index) => this.graphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.GRAPH_KNOWLEDGE}:${view.id}`,
      nodeId: view.id,
      target: ProjectionTarget.GRAPH_KNOWLEDGE,
      targetRef: view.id,
      version: index + 1,
    }));
  }
}
