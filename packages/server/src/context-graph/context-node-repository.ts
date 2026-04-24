import type { ContextNode } from '@mindstrate/protocol/models';
import type {
  ContextGraphStore,
  CreateContextNodeInput,
  UpdateContextNodeInput,
} from './context-graph-store.js';

export class ContextNodeRepository {
  constructor(private readonly graphStore: ContextGraphStore) {}

  create(input: CreateContextNodeInput): ContextNode {
    return this.graphStore.createNode(input);
  }

  get(id: string): ContextNode | null {
    return this.graphStore.getNodeById(id);
  }

  list(options: Parameters<ContextGraphStore['listNodes']>[0] = {}): ContextNode[] {
    return this.graphStore.listNodes(options);
  }

  update(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.graphStore.updateNode(id, input);
  }

  delete(id: string): boolean {
    return this.graphStore.deleteNode(id);
  }
}
