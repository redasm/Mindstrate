import type { ContextEdge, ContextRelationType } from '@mindstrate/protocol/models';
import type {
  ContextGraphStore,
  CreateContextEdgeInput,
} from './context-graph-store.js';

export class ContextEdgeRepository {
  constructor(private readonly graphStore: ContextGraphStore) {}

  create(input: CreateContextEdgeInput): ContextEdge {
    return this.graphStore.createEdge(input);
  }

  get(id: string): ContextEdge | null {
    return this.graphStore.getEdgeById(id);
  }

  list(options: Parameters<ContextGraphStore['listEdges']>[0] = {}): ContextEdge[] {
    return this.graphStore.listEdges(options);
  }

  outgoing(sourceId: string, relationType?: ContextRelationType): ContextEdge[] {
    return this.graphStore.listOutgoingEdges(sourceId, relationType);
  }

  incoming(targetId: string, relationType?: ContextRelationType): ContextEdge[] {
    return this.graphStore.listIncomingEdges(targetId, relationType);
  }
}
