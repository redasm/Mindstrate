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
  archiveCandidates: string[];
  deprecateCandidates: string[];
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
    const projectEnvironment = loadProjectEnvironment(nodes);

    let archivedNodes = 0;
    let deprecatedNodes = 0;
    let skippedConflictedNodes = 0;
    const archiveCandidates: string[] = [];
    const deprecateCandidates: string[] = [];
    const apply = options.apply === true;

    for (const node of nodes) {
      if (node.status === ContextNodeStatus.CONFLICTED) {
        skippedConflictedNodes++;
        continue;
      }
      if (node.status === ContextNodeStatus.ARCHIVED || node.status === ContextNodeStatus.DEPRECATED) {
        continue;
      }
      if (isProtected(node)) {
        continue;
      }

      if (shouldDeprecate(node, deprecateQualityScoreAtMost, deprecateNegativeFeedbackDeltaAtLeast)) {
        deprecateCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, { status: ContextNodeStatus.DEPRECATED });
          deprecatedNodes++;
        }
        continue;
      }

      if (isEnvironmentMismatch(node, projectEnvironment)) {
        deprecateCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, {
            status: ContextNodeStatus.DEPRECATED,
            metadata: {
              ...(node.metadata ?? {}),
              pruneReason: 'project_environment_mismatch',
              currentProjectEnvironment: projectEnvironment,
            },
          });
          deprecatedNodes++;
        }
        continue;
      }

      if (isCoveredByActiveHighLevelRule(this.graphStore, node)) {
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, { status: ContextNodeStatus.ARCHIVED });
          archivedNodes++;
        }
        continue;
      }

      if (shouldArchive(node, archiveOlderThanDays, archiveAccessCountAtMost)) {
        archiveCandidates.push(node.id);
        if (apply) {
          this.graphStore.updateNode(node.id, { status: ContextNodeStatus.ARCHIVED });
          archivedNodes++;
        }
      }
    }

    return {
      scannedNodes: nodes.length,
      archivedNodes,
      deprecatedNodes,
      skippedConflictedNodes,
      archiveCandidates,
      deprecateCandidates,
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
      && node.status !== ContextNodeStatus.DEPRECATED
      && node.status !== ContextNodeStatus.ARCHIVED)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return snapshots[0]?.metadata ?? {};
}

function isEnvironmentMismatch(node: ContextNode, projectEnvironment: Record<string, unknown>): boolean {
  if (node.domainType === ContextDomainType.PROJECT_SNAPSHOT) return false;
  if (node.status === ContextNodeStatus.VERIFIED) return false;

  const keys = ['runtime', 'language', 'framework'];
  return keys.some((key) => {
    const nodeValue = node.metadata?.[key];
    const projectValue = projectEnvironment[key];
    return typeof nodeValue === 'string'
      && typeof projectValue === 'string'
      && nodeValue.length > 0
      && projectValue.length > 0
      && nodeValue !== projectValue;
  });
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
