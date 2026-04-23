import {
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';

export interface InternalizationSuggestionOptions {
  project?: string;
  limit?: number;
}

export interface InternalizationSuggestions {
  agentsMd: string;
  projectSnapshotFragment: string;
  systemPromptFragment: string;
  sourceNodeIds: string[];
}

export class ContextInternalizer {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  generateSuggestions(options: InternalizationSuggestionOptions = {}): InternalizationSuggestions {
    const nodes = this.loadStableNodes(options);
    const bulletLines = nodes.map((node) => `- ${node.title}: ${node.content}`);

    return {
      agentsMd: [
        '## Mindstrate Internalized Guidance',
        ...bulletLines,
      ].join('\n'),
      projectSnapshotFragment: [
        '### Internalized Rules',
        ...bulletLines,
      ].join('\n'),
      systemPromptFragment: bulletLines.join('\n'),
      sourceNodeIds: nodes.map((node) => node.id),
    };
  }

  private loadStableNodes(options: InternalizationSuggestionOptions): ContextNode[] {
    const limit = options.limit ?? 10;
    const candidates = [
      ...this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.AXIOM,
        limit,
      }),
      ...this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.HEURISTIC,
        limit,
      }),
      ...this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.RULE,
        limit,
      }),
    ];

    return candidates
      .filter((node) =>
        [ContextNodeStatus.VERIFIED, ContextNodeStatus.ACTIVE].includes(node.status) &&
        node.confidence >= 0.7 &&
        node.qualityScore >= 70
      )
      .sort((a, b) => b.qualityScore - a.qualityScore || b.confidence - a.confidence)
      .slice(0, limit);
  }
}
