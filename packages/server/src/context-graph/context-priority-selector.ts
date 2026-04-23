import type { ContextGraphStore } from './context-graph-store.js';
import { ContextNodeStatus, SubstrateType, type ContextNode } from '@mindstrate/protocol/models';

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
      rules: this.selectLayer(SubstrateType.RULE, options.project, perLayerLimit),
      patterns: this.selectLayer(SubstrateType.PATTERN, options.project, perLayerLimit),
      summaries: this.selectLayer(SubstrateType.SUMMARY, options.project, perLayerLimit),
    };
  }

  private selectLayer(substrateType: SubstrateType, project: string | undefined, limit: number): ContextNode[] {
    return this.graphStore.listNodes({
      project,
      substrateType,
      limit: limit * 3,
    })
      .filter((node) => SELECTABLE_STATUSES.has(node.status))
      .slice(0, limit);
  }
}

const SELECTABLE_STATUSES = new Set([
  ContextNodeStatus.ACTIVE,
  ContextNodeStatus.VERIFIED,
  ContextNodeStatus.CANDIDATE,
]);
