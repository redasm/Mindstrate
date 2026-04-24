import {
  ContextDomainType,
  ProjectionTarget,
  SubstrateType,
  type ProjectionRecord,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface SessionProjectionOptions {
  project?: string;
  limit?: number;
}

export class SessionProjectionMaterializer {
  constructor(private readonly graphStore: ContextGraphStore) {}

  materialize(options: SessionProjectionOptions = {}): ProjectionRecord[] {
    const nodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: options.limit ?? 100,
    });

    return nodes.map((node, index) => this.graphStore.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.SESSION_SUMMARY}:${node.id}`,
      nodeId: node.id,
      target: ProjectionTarget.SESSION_SUMMARY,
      targetRef: node.sourceRef ?? node.id,
      version: index + 1,
    }));
  }
}
