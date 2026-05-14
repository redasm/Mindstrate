import type { EvolutionRunMode, EvolutionRunResult, EvolutionSuggestion, EvolutionSuggestionSummary } from '@mindstrate/protocol';
import {
  ContextNodeStatus,
  ContextRelationType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { Pruner } from './pruner.js';

export interface RunEvolutionOptions {
  autoApply?: boolean;
  maxItems?: number;
  mode?: EvolutionRunMode;
  project?: string;
}

const DEFAULT_MAX_ITEMS = 100;
const EXACT_MERGE_CONFIDENCE = 0.95;
const AUTO_APPLY_MERGE_CONFIDENCE = 0.95;
const AUTO_APPLY_ARCHIVE_CONFIDENCE = 0.9;
const AUTO_APPLY_VALIDATE_CONFIDENCE = 0.85;

export class EvolutionEngine {
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly pruner: Pruner,
  ) {}

  run(options: RunEvolutionOptions = {}): EvolutionRunResult {
    const mode = options.mode ?? 'standard';
    const maxItems = normalizeMaxItems(options.maxItems);
    const nodes = this.graphStore.listNodes({
      project: options.project,
      limit: maxItems,
    });
    const suggestions = this.buildSuggestions(nodes, options.project, maxItems);
    let autoApplied = 0;
    if (options.autoApply === true) {
      for (const suggestion of suggestions) {
        if (this.applySuggestion(suggestion)) autoApplied++;
      }
    }

    return {
      mode,
      scanned: nodes.length,
      suggestions,
      summary: summarizeSuggestions(suggestions),
      llmEnhanced: 0,
      autoApplied,
      pendingReview: Math.max(0, suggestions.length - autoApplied),
    };
  }

  applySuggestion(suggestion: EvolutionSuggestion): boolean {
    const node = this.graphStore.getNodeById(suggestion.nodeId);
    if (!node) return false;

    if (suggestion.type === 'merge') {
      if (suggestion.confidence < AUTO_APPLY_MERGE_CONFIDENCE) return false;
      return this.applyExactMerge(node, suggestion);
    }
    if (suggestion.type === 'archive') {
      if (suggestion.confidence < AUTO_APPLY_ARCHIVE_CONFIDENCE) return false;
      return this.archiveNode(node, suggestion);
    }
    if (suggestion.type === 'validate') {
      if (suggestion.confidence < AUTO_APPLY_VALIDATE_CONFIDENCE) return false;
      return this.validateNode(node, suggestion);
    }
    if (suggestion.type === 'improve' && suggestion.suggestedUpdate) {
      this.graphStore.updateNode(node.id, {
        ...suggestion.suggestedUpdate,
        metadata: withEvolutionAudit(node, suggestion, 'improve'),
      });
      return true;
    }

    return false;
  }

  private buildSuggestions(
    nodes: ContextNode[],
    project: string | undefined,
    maxItems: number,
  ): EvolutionSuggestion[] {
    const suggestions: EvolutionSuggestion[] = [];
    const activeNodes = nodes.filter((node) => node.status !== ContextNodeStatus.ARCHIVED);
    const archiveSuggestions = this.pruner.prune({ project, mode: 'suggest' }).suggestions.map((suggestion) => ({
      nodeId: suggestion.nodeId,
      type: 'archive' as const,
      description: `Archive stale or low-value node: ${suggestion.reason}`,
      confidence: archiveConfidence(suggestion.reason),
    }));
    const archiveNodeIds = new Set(archiveSuggestions.map((suggestion) => suggestion.nodeId));
    const retainedNodes = activeNodes.filter((node) => !archiveNodeIds.has(node.id));

    suggestions.push(...detectExactDuplicates(retainedNodes));
    suggestions.push(...detectValidationCandidates(retainedNodes));
    suggestions.push(...detectImprovementCandidates(retainedNodes));
    suggestions.push(...detectSplitCandidates(retainedNodes));
    suggestions.push(...archiveSuggestions);
    return dedupeSuggestions(suggestions).slice(0, maxItems);
  }

  private applyExactMerge(primary: ContextNode, suggestion: EvolutionSuggestion): boolean {
    const relatedIds = suggestion.relatedIds ?? [];
    let changed = false;
    for (const duplicateId of relatedIds) {
      const duplicate = this.graphStore.getNodeById(duplicateId);
      if (!duplicate || duplicate.status === ContextNodeStatus.ARCHIVED) continue;
      if (!isExactDuplicate(primary, duplicate)) continue;
      this.graphStore.updateNode(duplicate.id, {
        status: ContextNodeStatus.ARCHIVED,
        metadata: withEvolutionAudit(duplicate, suggestion, 'merge_duplicate'),
      });
      try {
        this.graphStore.createEdge({
          id: `evolution:${duplicate.id}->${primary.id}:generalizes`,
          sourceId: duplicate.id,
          targetId: primary.id,
          relationType: ContextRelationType.GENERALIZES,
          strength: suggestion.confidence,
          evidence: { reason: 'evolution_exact_duplicate_merge' },
        });
      } catch {
        // Existing deterministic edge means the merge was already applied.
      }
      changed = true;
    }
    if (changed) {
      this.graphStore.updateNode(primary.id, {
        metadata: withEvolutionAudit(primary, suggestion, 'merge_primary'),
      });
    }
    return changed;
  }

  private archiveNode(node: ContextNode, suggestion: EvolutionSuggestion): boolean {
    if (node.status === ContextNodeStatus.ARCHIVED || node.status === ContextNodeStatus.VERIFIED) return false;
    this.graphStore.updateNode(node.id, {
      status: ContextNodeStatus.ARCHIVED,
      metadata: withEvolutionAudit(node, suggestion, 'archive'),
    });
    return true;
  }

  private validateNode(node: ContextNode, suggestion: EvolutionSuggestion): boolean {
    if (node.status !== ContextNodeStatus.CANDIDATE) return false;
    this.graphStore.updateNode(node.id, {
      status: ContextNodeStatus.ACTIVE,
      metadata: withEvolutionAudit(node, suggestion, 'validate'),
    });
    return true;
  }
}

const normalizeMaxItems = (maxItems: number | undefined): number => {
  if (!Number.isFinite(maxItems)) return DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.floor(maxItems!));
};

const detectExactDuplicates = (nodes: ContextNode[]): EvolutionSuggestion[] => {
  const groups = new Map<string, ContextNode[]>();
  for (const node of nodes.filter((entry) => entry.status !== ContextNodeStatus.CONFLICTED)) {
    const key = duplicateKey(node);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }

  const suggestions: EvolutionSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [primary, ...duplicates] = [...group].sort(compareMergePriority);
    suggestions.push({
      nodeId: primary!.id,
      type: 'merge',
      description: `Merge ${duplicates.length} exact duplicate node(s) into "${primary!.title}".`,
      confidence: EXACT_MERGE_CONFIDENCE,
      relatedIds: duplicates.map((node) => node.id),
    });
  }
  return suggestions;
};

const detectValidationCandidates = (nodes: ContextNode[]): EvolutionSuggestion[] => nodes
  .filter((node) => node.status === ContextNodeStatus.CANDIDATE)
  .filter((node) => (node.qualityScore >= 85 && node.confidence >= 0.75)
    || (node.positiveFeedback >= 2 && node.negativeFeedback === 0))
  .map((node) => ({
    nodeId: node.id,
    type: 'validate' as const,
    description: `Promote high-confidence candidate "${node.title}" to active knowledge.`,
    confidence: node.positiveFeedback >= 2 ? 0.9 : 0.85,
  }));

const detectImprovementCandidates = (nodes: ContextNode[]): EvolutionSuggestion[] => nodes
  .filter((node) => [ContextNodeStatus.ACTIVE, ContextNodeStatus.CANDIDATE].includes(node.status))
  .filter((node) => node.qualityScore < 55 || node.confidence < 0.35)
  .map((node) => ({
    nodeId: node.id,
    type: 'improve' as const,
    description: `Improve weak knowledge "${node.title}" because quality/confidence is low.`,
    confidence: 0.7,
    suggestedUpdate: {
      tags: uniqueStrings([...node.tags, 'needs-improvement']),
    },
  }));

const detectSplitCandidates = (nodes: ContextNode[]): EvolutionSuggestion[] => nodes
  .filter((node) => [ContextNodeStatus.ACTIVE, ContextNodeStatus.CANDIDATE].includes(node.status))
  .filter((node) => node.content.length > 2500 && headingCount(node.content) >= 3)
  .map((node) => ({
    nodeId: node.id,
    type: 'split' as const,
    description: `Split oversized mixed-responsibility node "${node.title}" into focused entries.`,
    confidence: 0.65,
  }));

const archiveConfidence = (reason: string): number => {
  if (reason === 'low_quality_or_negative_feedback') return 0.95;
  if (reason === 'covered_by_high_level_rule') return 0.9;
  return 0.8;
};

const duplicateKey = (node: ContextNode): string => [
  node.project ?? '',
  node.substrateType,
  node.domainType,
  normalizeText(node.title),
  normalizeText(node.content),
].join('|');

const isExactDuplicate = (left: ContextNode, right: ContextNode): boolean =>
  duplicateKey(left) === duplicateKey(right);

const compareMergePriority = (left: ContextNode, right: ContextNode): number => {
  const score = (node: ContextNode): number =>
    node.qualityScore + node.confidence * 10 + node.positiveFeedback - node.negativeFeedback;
  const scoreDiff = score(right) - score(left);
  if (scoreDiff !== 0) return scoreDiff;
  return right.updatedAt.localeCompare(left.updatedAt);
};

const headingCount = (content: string): number =>
  content.split(/\r?\n/).filter((line) => /^#{1,3}\s+\S/.test(line.trim())).length;

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const uniqueStrings = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const dedupeSuggestions = (suggestions: EvolutionSuggestion[]): EvolutionSuggestion[] => {
  const seen = new Set<string>();
  const result: EvolutionSuggestion[] = [];
  for (const suggestion of suggestions) {
    const key = `${suggestion.type}:${suggestion.nodeId}:${suggestion.relatedIds?.join(',') ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(suggestion);
  }
  return result.sort(compareSuggestionPriority);
};

const compareSuggestionPriority = (left: EvolutionSuggestion, right: EvolutionSuggestion): number => {
  const priority = (suggestion: EvolutionSuggestion): number => {
    if (suggestion.type === 'merge') return 5;
    if (suggestion.type === 'archive') return 4;
    if (suggestion.type === 'validate') return 3;
    if (suggestion.type === 'improve') return 2;
    return 1;
  };
  const priorityDiff = priority(right) - priority(left);
  if (priorityDiff !== 0) return priorityDiff;
  return right.confidence - left.confidence;
};

const summarizeSuggestions = (suggestions: EvolutionSuggestion[]): EvolutionSuggestionSummary => ({
  merge: suggestions.filter((suggestion) => suggestion.type === 'merge').length,
  improve: suggestions.filter((suggestion) => suggestion.type === 'improve').length,
  validate: suggestions.filter((suggestion) => suggestion.type === 'validate').length,
  archive: suggestions.filter((suggestion) => suggestion.type === 'archive').length,
  split: suggestions.filter((suggestion) => suggestion.type === 'split').length,
});

const withEvolutionAudit = (
  node: ContextNode,
  suggestion: EvolutionSuggestion,
  action: string,
): Record<string, unknown> => ({
  ...(node.metadata ?? {}),
  evolutionAudit: {
    action,
    suggestionType: suggestion.type,
    confidence: suggestion.confidence,
    relatedIds: suggestion.relatedIds ?? [],
    decidedAt: new Date().toISOString(),
  },
});
