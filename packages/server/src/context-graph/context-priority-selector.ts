import type { ContextGraphStore } from './context-graph-store.js';
import { ContextNodeStatus, SubstrateType, type ContextNode } from '@mindstrate/protocol/models';
import type { RetrievalContext } from '@mindstrate/protocol';

export interface ContextPrioritySelection {
  rules: ContextNode[];
  patterns: ContextNode[];
  summaries: ContextNode[];
}

export interface ContextPrioritySelectorOptions {
  project?: string;
  context?: RetrievalContext;
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
      rules: this.selectLayer(SubstrateType.RULE, options, perLayerLimit),
      patterns: this.selectLayer(SubstrateType.PATTERN, options, perLayerLimit),
      summaries: this.selectLayer(SubstrateType.SUMMARY, options, perLayerLimit),
    };
  }

  private selectLayer(substrateType: SubstrateType, options: ContextPrioritySelectorOptions, limit: number): ContextNode[] {
    const signals = buildContextSignals(options.context);
    return this.graphStore.listNodes({
      project: options.project,
      substrateType,
      limit: Math.max(limit * 10, 50),
    })
      .filter((node) => SELECTABLE_STATUSES.has(node.status))
      .sort((a, b) => scoreNode(b, signals) - scoreNode(a, signals))
      .slice(0, limit);
  }
}

const SELECTABLE_STATUSES = new Set([
  ContextNodeStatus.ACTIVE,
  ContextNodeStatus.VERIFIED,
  ContextNodeStatus.CANDIDATE,
]);

function buildContextSignals(context?: RetrievalContext): string[] {
  if (!context) return [];
  return [
    context.currentFile,
    context.currentFile?.split(/[\\/]/).pop(),
    context.currentLanguage,
    context.currentFramework,
    context.errorMessage,
    context.recentCode,
    ...(context.projectDependencies ?? []),
  ]
    .flatMap((value) => tokenize(String(value ?? '')))
    .filter((value, index, array) => value.length > 1 && array.indexOf(value) === index);
}

function scoreNode(node: ContextNode, signals: string[]): number {
  const haystack = [
    node.title,
    node.content,
    node.domainType,
    node.tags.join(' '),
    node.sourceRef,
    JSON.stringify(node.metadata ?? {}),
  ].join('\n').toLowerCase();

  const contextScore = signals.reduce((score, signal) => haystack.includes(signal) ? score + 1 : score, 0);
  return contextScore * 100 + node.qualityScore + node.confidence * 10 + node.positiveFeedback - node.negativeFeedback;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff./@_-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}
