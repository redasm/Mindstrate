import {
  ContextDomainType,
  ProjectionTarget,
  SubstrateType,
  type ProjectionRecord,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface ProjectSnapshotProjectionOptions {
  project?: string;
  limit?: number;
}

export class ProjectSnapshotProjectionMaterializer {
  constructor(private readonly graphStore: ContextGraphStore) {}

  materialize(options: ProjectSnapshotProjectionOptions = {}): ProjectionRecord[] {
    const nodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      limit: options.limit ?? 100,
    });

    return nodes.map((node, index) => this.graphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_SNAPSHOT}:${node.id}`,
      nodeId: node.id,
      target: ProjectionTarget.PROJECT_SNAPSHOT,
      targetRef: node.sourceRef ?? node.project ?? node.id,
      version: index + 1,
    }));
  }
}
