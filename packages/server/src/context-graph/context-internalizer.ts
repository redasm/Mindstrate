import {
  ContextNodeStatus,
  ProjectionTarget,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type {
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestions,
  ProjectionRecord,
} from '@mindstrate/protocol';
import type { ContextGraphStore } from './context-graph-store.js';

export type {
  AcceptInternalizationSuggestionsResult,
  InternalizationSuggestions,
} from '@mindstrate/protocol';

export interface InternalizationSuggestionOptions {
  project?: string;
  limit?: number;
}

export type InternalizationTarget =
  | ProjectionTarget.AGENTS_MD
  | ProjectionTarget.PROJECT_SNAPSHOT
  | ProjectionTarget.SYSTEM_PROMPT
  | ProjectionTarget.FINE_TUNE_DATASET;

export interface AcceptInternalizationSuggestionsOptions extends InternalizationSuggestionOptions {
  targets?: InternalizationTarget[];
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
      fineTuneDatasetJsonl: nodes.map(toFineTuneExample).join('\n'),
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
      ProjectionTarget.FINE_TUNE_DATASET,
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
    case ProjectionTarget.FINE_TUNE_DATASET:
      return `${scope}:fine-tune-dataset.jsonl`;
  }
}

function toFineTuneExample(node: ContextNode): string {
  return JSON.stringify({
    sourceNodeId: node.id,
    project: node.project,
    substrateType: node.substrateType,
    domainType: node.domainType,
    status: node.status,
    confidence: node.confidence,
    qualityScore: node.qualityScore,
    messages: [
      {
        role: 'system',
        content: 'Mindstrate ECS guidance: answer with stable, graph-verified project knowledge only.',
      },
      {
        role: 'user',
        content: `What guidance should be internalized for "${node.title}"?`,
      },
      {
        role: 'assistant',
        content: node.content,
      },
    ],
  });
}
