import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
  type ConflictRecord,
} from '@mindstrate/protocol/models';

export interface ConflictReflectionOptions {
  project?: string;
  limit?: number;
}

export interface ConflictReflectionResult {
  scannedConflicts: number;
  candidateNodesCreated: number;
  candidateNodeIds: string[];
  auditEventIds: string[];
}

export class ConflictReflector {
  private readonly graphStore: ContextGraphStore;

  constructor(graphStore: ContextGraphStore) {
    this.graphStore = graphStore;
  }

  reflectConflicts(options: ConflictReflectionOptions = {}): ConflictReflectionResult {
    const conflicts = this.graphStore.listConflictRecords({
      project: options.project,
      limit: options.limit ?? 100,
    }).filter((record) => !this.hasReflectionNode(record.id));

    const candidateNodeIds: string[] = [];
    const auditEventIds: string[] = [];

    for (const conflict of conflicts) {
      const nodes = conflict.nodeIds
        .map((id) => this.graphStore.getNodeById(id))
        .filter((node): node is NonNullable<typeof node> => Boolean(node));
      if (nodes.length < 2) continue;

      const candidate = this.graphStore.createNode({
        substrateType: SubstrateType.SUMMARY,
        domainType: resolveReflectionDomain(nodes[0].domainType),
        title: `Conflict reflection: ${nodes[0].title}`,
        content: buildConflictReflectionContent(conflict, nodes),
        tags: ['conflict-reflection', 'candidate-resolution'],
        project: conflict.project,
        compressionLevel: 0.05,
        confidence: 0.6,
        qualityScore: 55,
        status: ContextNodeStatus.CANDIDATE,
        sourceRef: conflict.id,
        metadata: {
          conflictId: conflict.id,
          sourceNodeIds: conflict.nodeIds,
        },
      });

      for (const node of nodes) {
        this.graphStore.createEdge({
          sourceId: node.id,
          targetId: candidate.id,
          relationType: ContextRelationType.DERIVED_FROM,
          strength: 1,
          evidence: {
            conflictId: conflict.id,
          },
        });
      }

      candidateNodeIds.push(candidate.id);
      const audit = this.graphStore.createEvent({
        type: ContextEventType.METABOLIC_OUTPUT,
        project: conflict.project,
        actor: 'metabolism.reflect',
        content: `Created reflection candidate ${candidate.id} for conflict ${conflict.id}.`,
        metadata: {
          conflictId: conflict.id,
          candidateNodeId: candidate.id,
          sourceNodeIds: conflict.nodeIds,
        },
      });
      auditEventIds.push(audit.id);
    }

    return {
      scannedConflicts: conflicts.length,
      candidateNodesCreated: candidateNodeIds.length,
      candidateNodeIds,
      auditEventIds,
    };
  }

  private hasReflectionNode(conflictId: string): boolean {
    return this.graphStore.listNodes({
      sourceRef: conflictId,
      limit: 1,
    }).length > 0;
  }
}

function resolveReflectionDomain(domainType: ContextDomainType): ContextDomainType {
  switch (domainType) {
    case ContextDomainType.CONVENTION:
    case ContextDomainType.ARCHITECTURE:
    case ContextDomainType.PATTERN:
      return domainType;
    default:
      return ContextDomainType.CONTEXT_EVENT;
  }
}

function buildConflictReflectionContent(
  conflict: ConflictRecord,
  nodes: Array<{ id: string; title: string; content: string }>,
): string {
  const sections = [
    `Conflict detected at ${conflict.detectedAt}.`,
    `Reason: ${conflict.reason}`,
    '',
    'Conflicting nodes:',
    ...nodes.map((node, index) => `${index + 1}. ${node.title} (${node.id})\n${node.content}`),
    '',
    'Reflection task:',
    '- Determine whether one node is outdated, context-specific, or simply wrong.',
    '- Derive a narrower rule or scoped exception instead of deleting evidence too early.',
  ];

  return sections.join('\n');
}
