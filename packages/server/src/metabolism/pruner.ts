import {
  ContextRelationType,
  ContextNodeStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export interface PruneOptions {
  project?: string;
  archiveOlderThanDays?: number;
  archiveAccessCountAtMost?: number;
  deprecateQualityScoreAtMost?: number;
  deprecateNegativeFeedbackDeltaAtLeast?: number;
}

export interface PruneResult {
  scannedNodes: number;
  archivedNodes: number;
  deprecatedNodes: number;
  skippedConflictedNodes: number;
}

export class Pruner {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  prune(options: PruneOptions = {}): PruneResult {
    const archiveOlderThanDays = options.archiveOlderThanDays ?? 30;
    const archiveAccessCountAtMost = options.archiveAccessCountAtMost ?? 1;
    const deprecateQualityScoreAtMost = options.deprecateQualityScoreAtMost ?? 20;
    const deprecateNegativeFeedbackDeltaAtLeast = options.deprecateNegativeFeedbackDeltaAtLeast ?? 3;
    const nodes = this.graphStore.listNodes({
      project: options.project,
      limit: 1000,
    });

    let archivedNodes = 0;
    let deprecatedNodes = 0;
    let skippedConflictedNodes = 0;

    for (const node of nodes) {
      if (node.status === ContextNodeStatus.CONFLICTED) {
        skippedConflictedNodes++;
        continue;
      }
      if (node.status === ContextNodeStatus.ARCHIVED || node.status === ContextNodeStatus.DEPRECATED) {
        continue;
      }

      if (shouldDeprecate(node, deprecateQualityScoreAtMost, deprecateNegativeFeedbackDeltaAtLeast)) {
        this.graphStore.updateNode(node.id, { status: ContextNodeStatus.DEPRECATED });
        deprecatedNodes++;
        continue;
      }

      if (isCoveredByActiveHighLevelRule(this.graphStore, node)) {
        this.graphStore.updateNode(node.id, { status: ContextNodeStatus.ARCHIVED });
        archivedNodes++;
        continue;
      }

      if (shouldArchive(node, archiveOlderThanDays, archiveAccessCountAtMost)) {
        this.graphStore.updateNode(node.id, { status: ContextNodeStatus.ARCHIVED });
        archivedNodes++;
      }
    }

    return {
      scannedNodes: nodes.length,
      archivedNodes,
      deprecatedNodes,
      skippedConflictedNodes,
    };
  }
}

function shouldDeprecate(
  node: ContextNode,
  deprecateQualityScoreAtMost: number,
  deprecateNegativeFeedbackDeltaAtLeast: number,
): boolean {
  return node.qualityScore <= deprecateQualityScoreAtMost
    || (node.negativeFeedback - node.positiveFeedback) >= deprecateNegativeFeedbackDeltaAtLeast;
}

function isCoveredByActiveHighLevelRule(
  graphStore: ContextGraphStore,
  node: ContextNode,
): boolean {
  if ([SubstrateType.RULE, SubstrateType.HEURISTIC, SubstrateType.AXIOM].includes(node.substrateType)) {
    return false;
  }

  return graphStore.listOutgoingEdges(node.id, ContextRelationType.GENERALIZES).some((edge) => {
    const target = graphStore.getNodeById(edge.targetId);
    return target !== null
      && [SubstrateType.RULE, SubstrateType.HEURISTIC, SubstrateType.AXIOM].includes(target.substrateType)
      && [ContextNodeStatus.ACTIVE, ContextNodeStatus.VERIFIED].includes(target.status);
  });
}

function shouldArchive(
  node: ContextNode,
  archiveOlderThanDays: number,
  archiveAccessCountAtMost: number,
): boolean {
  if (![SubstrateType.EPISODE, SubstrateType.SNAPSHOT, SubstrateType.SUMMARY].includes(node.substrateType)) {
    return false;
  }

  const staleSince = node.lastAccessedAt ?? node.updatedAt;
  const ageMs = Date.now() - new Date(staleSince).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays >= archiveOlderThanDays && node.accessCount <= archiveAccessCountAtMost;
}
