import type { ContextGraphStore } from './context-graph-store.js';
import { SubstrateType, type ContextNode } from '@mindstrate/protocol/models';

export interface ContextPrioritySelection {
  rules: ContextNode[];
  patterns: ContextNode[];
  summaries: ContextNode[];
}

export interface ContextPrioritySelectorOptions {
  project?: string;
  perLayerLimit?: number;
}

export class ContextPrioritySelector {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  select(options: ContextPrioritySelectorOptions = {}): ContextPrioritySelection {
    const perLayerLimit = options.perLayerLimit ?? 5;

    return {
      rules: this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.RULE,
        limit: perLayerLimit,
      }),
      patterns: this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.PATTERN,
        limit: perLayerLimit,
      }),
      summaries: this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.SUMMARY,
        limit: perLayerLimit,
      }),
    };
  }
}
