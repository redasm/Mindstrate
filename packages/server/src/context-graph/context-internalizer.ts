import {
  ContextNodeStatus,
  ProjectionTarget,
  SubstrateType,
  type ProjectionRecord,
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

export type InternalizationTarget =
  | ProjectionTarget.AGENTS_MD
  | ProjectionTarget.PROJECT_SNAPSHOT
  | ProjectionTarget.SYSTEM_PROMPT;

export interface AcceptInternalizationSuggestionsOptions extends InternalizationSuggestionOptions {
  targets?: InternalizationTarget[];
}

export interface AcceptInternalizationSuggestionsResult extends InternalizationSuggestions {
  records: ProjectionRecord[];
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

  acceptSuggestions(
    options: AcceptInternalizationSuggestionsOptions = {},
  ): AcceptInternalizationSuggestionsResult {
    const suggestions = this.generateSuggestions(options);
    const targets = options.targets ?? [
      ProjectionTarget.AGENTS_MD,
      ProjectionTarget.PROJECT_SNAPSHOT,
      ProjectionTarget.SYSTEM_PROMPT,
    ];
    const records: ProjectionRecord[] = [];
    const version = Date.now();

    for (const nodeId of suggestions.sourceNodeIds) {
      for (const target of targets) {
        records.push(this.graphStore.upsertProjectionRecord({
          id: `internalization:${target}:${nodeId}`,
          nodeId,
          target,
          targetRef: buildTargetRef(target, options.project),
          version,
        }));
      }
    }

    return {
      ...suggestions,
      records,
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

function buildTargetRef(target: InternalizationTarget, project?: string): string {
  const scope = project ?? 'global';
  switch (target) {
    case ProjectionTarget.AGENTS_MD:
      return `${scope}:AGENTS.md`;
    case ProjectionTarget.PROJECT_SNAPSHOT:
      return `${scope}:project-snapshot`;
    case ProjectionTarget.SYSTEM_PROMPT:
      return `${scope}:system-prompt`;
  }
}
