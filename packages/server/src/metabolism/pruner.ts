import {
  ContextDomainType,
  ContextRelationType,
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface PruneOptions {
  project?: string;
  apply?: boolean;
  mode?: 'suggest' | 'apply';
  archiveOlderThanDays?: number;
  archiveAccessCountAtMost?: number;
  archiveQualityScoreAtMost?: number;
  archiveNegativeFeedbackDeltaAtLeast?: number;
}

export interface PruneSuggestion {
  nodeId: string;
  action: 'archive';
  reason: string;
  evidence: Record<string, unknown>;
}

export interface PruneResult {
  scannedNodes: number;
  archivedNodes: number;
  skippedConflictedNodes: number;
  archiveCandidates: string[];
  suggestions: PruneSuggestion[];
}

export class Pruner {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  prune(options: PruneOptions = {}): PruneResult {
    const archiveOlderThanDays = options.archiveOlderThanDays ?? 30;
    const archiveAccessCountAtMost = options.archiveAccessCountAtMost ?? 1;
    const archiveQualityScoreAtMost = options.archiveQualityScoreAtMost ?? 20;
    const archiveNegativeFeedbackDeltaAtLeast = options.archiveNegativeFeedbackDeltaAtLeast ?? 3;
    const nodes = this.graphStore.listNodes({
      project: options.project,
      limit: 1000,
    });
    const projectEnvironment = loadProjectEnvironment(nodes);

    let archivedNodes = 0;
    let skippedConflictedNodes = 0;
    const archiveCandidates: string[] = [];
    const suggestions: PruneSuggestion[] = [];
    const apply = options.mode === 'apply' || options.apply === true;

    for (const node of nodes) {
      if (node.status === ContextNodeStatus.CONFLICTED) {
        skippedConflictedNodes++;
        continue;
      }
      if (node.status === ContextNodeStatus.ARCHIVED) {
        continue;
      }
      if (isProtected(node)) {
        continue;
      }

      const lowQualityEvidence = getLowQualityEvidence(node, archiveQualityScoreAtMost, archiveNegativeFeedbackDeltaAtLeast);
      if (lowQualityEvidence) {
        const suggestion = makeSuggestion(node.id, 'archive', 'low_quality_or_negative_feedback', lowQualityEvidence);
        suggestions.push(suggestion);
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, {
            status: ContextNodeStatus.ARCHIVED,
            metadata: withPruneAudit(node, suggestion),
          });
          archivedNodes++;
        }
        continue;
      }

      const environmentMismatchEvidence = getEnvironmentMismatchEvidence(node, projectEnvironment);
      if (environmentMismatchEvidence) {
        const suggestion = makeSuggestion(node.id, 'archive', 'project_environment_mismatch', environmentMismatchEvidence);
        suggestions.push(suggestion);
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, {
            status: ContextNodeStatus.ARCHIVED,
            metadata: withPruneAudit(node, suggestion),
          });
          archivedNodes++;
        }
        continue;
      }

      const coverageEvidence = getActiveHighLevelRuleCoverage(this.graphStore, node);
      if (coverageEvidence) {
        const suggestion = makeSuggestion(node.id, 'archive', 'covered_by_high_level_rule', coverageEvidence);
        suggestions.push(suggestion);
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, {
            status: ContextNodeStatus.ARCHIVED,
            metadata: withPruneAudit(node, suggestion),
          });
          archivedNodes++;
        }
        continue;
      }

      const archiveEvidence = getArchiveEvidence(node, archiveOlderThanDays, archiveAccessCountAtMost);
      if (archiveEvidence) {
        const suggestion = makeSuggestion(node.id, 'archive', 'stale_low_access_substrate', archiveEvidence);
        suggestions.push(suggestion);
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, {
            status: ContextNodeStatus.ARCHIVED,
            metadata: withPruneAudit(node, suggestion),
          });
          archivedNodes++;
        }
      }
    }

    return {
      scannedNodes: nodes.length,
      archivedNodes,
      skippedConflictedNodes,
      archiveCandidates,
      suggestions,
    };
  }
}

function isProtected(node: ContextNode): boolean {
  if (node.status === ContextNodeStatus.VERIFIED) return true;
  return node.metadata?.['pinned'] === true
    || node.metadata?.['critical'] === true
    || node.metadata?.['retentionPolicy'] === 'keep';
}

function loadProjectEnvironment(nodes: ContextNode[]): Record<string, unknown> {
  const snapshots = nodes
    .filter((node) => node.substrateType === SubstrateType.SNAPSHOT
      && node.domainType === ContextDomainType.PROJECT_SNAPSHOT
      && node.status !== ContextNodeStatus.ARCHIVED)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return snapshots[0]?.metadata ?? {};
}

function getEnvironmentMismatchEvidence(
  node: ContextNode,
  projectEnvironment: Record<string, unknown>,
): Record<string, unknown> | null {
  if (node.domainType === ContextDomainType.PROJECT_SNAPSHOT) return null;
  if (node.status === ContextNodeStatus.VERIFIED) return null;

  const keys = ['runtime', 'language', 'framework'];
  const mismatches: Record<string, unknown> = {};
  for (const key of keys) {
    const nodeValue = node.metadata?.[key];
    const projectValue = projectEnvironment[key];
    if (typeof nodeValue === 'string'
      && typeof projectValue === 'string'
      && nodeValue.length > 0
      && projectValue.length > 0
      && nodeValue !== projectValue) {
      mismatches[key] = {
        node: nodeValue,
        project: projectValue,
      };
    }
  }

  return Object.keys(mismatches).length > 0 ? mismatches : null;
}

function getLowQualityEvidence(
  node: ContextNode,
  archiveQualityScoreAtMost: number,
  archiveNegativeFeedbackDeltaAtLeast: number,
): Record<string, unknown> | null {
  const feedbackDelta = node.negativeFeedback - node.positiveFeedback;
  if (node.qualityScore > archiveQualityScoreAtMost && feedbackDelta < archiveNegativeFeedbackDeltaAtLeast) {
    return null;
  }
  return {
    qualityScore: node.qualityScore,
    archiveQualityScoreAtMost,
    feedbackDelta,
    archiveNegativeFeedbackDeltaAtLeast,
  };
}

function getActiveHighLevelRuleCoverage(
  graphStore: ContextGraphStore,
  node: ContextNode,
): Record<string, unknown> | null {
  if ([SubstrateType.RULE, SubstrateType.HEURISTIC, SubstrateType.AXIOM].includes(node.substrateType)) {
    return null;
  }

  for (const edge of graphStore.listOutgoingEdges(node.id, ContextRelationType.GENERALIZES)) {
    const target = graphStore.getNodeById(edge.targetId);
    if (target !== null
      && [SubstrateType.RULE, SubstrateType.HEURISTIC, SubstrateType.AXIOM].includes(target.substrateType)
      && [ContextNodeStatus.ACTIVE, ContextNodeStatus.VERIFIED].includes(target.status)) {
      return {
        edgeId: edge.id,
        ruleId: target.id,
        ruleTitle: target.title,
        relationType: edge.relationType,
      };
    }
  }

  return null;
}

function getArchiveEvidence(
  node: ContextNode,
  archiveOlderThanDays: number,
  archiveAccessCountAtMost: number,
): Record<string, unknown> | null {
  if (![SubstrateType.EPISODE, SubstrateType.SNAPSHOT, SubstrateType.SUMMARY].includes(node.substrateType)) {
    return null;
  }

  const staleSince = node.lastAccessedAt ?? node.updatedAt;
  const ageMs = Date.now() - new Date(staleSince).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < archiveOlderThanDays || node.accessCount > archiveAccessCountAtMost) {
    return null;
  }
  return {
    staleSince,
    ageDays,
    archiveOlderThanDays,
    accessCount: node.accessCount,
    archiveAccessCountAtMost,
  };
}

function makeSuggestion(
  nodeId: string,
  action: PruneSuggestion['action'],
  reason: string,
  evidence: Record<string, unknown>,
): PruneSuggestion {
  return {
    nodeId,
    action,
    reason,
    evidence,
  };
}

function withPruneAudit(node: ContextNode, suggestion: PruneSuggestion): Record<string, unknown> {
  return {
    ...(node.metadata ?? {}),
    pruneAudit: {
      action: suggestion.action,
      reason: suggestion.reason,
      evidence: suggestion.evidence,
      decidedAt: new Date().toISOString(),
    },
  };
}
