import { createHash } from 'node:crypto';
import {
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

const HIGH_ORDER_SUBSTRATES: readonly SubstrateType[] = [
  SubstrateType.SKILL,
  SubstrateType.RULE,
  SubstrateType.HEURISTIC,
  SubstrateType.AXIOM,
];

export interface SkillTransferDeps {
  graphStore: ContextGraphStore;
}

export interface SkillTransferOptions {
  fromProject: string;
  toProject: string;
  /** Cap on nodes transferred per run. Defaults to 200. */
  limit?: number;
}

export interface SkillTransferResult {
  transferred: number;
  skipped: number;
  targetNodeIds: string[];
}

/**
 * Cross-project skill transfer: copy a source project's verified
 * high-order knowledge (skill / rule / heuristic / axiom) into a target
 * project as candidates, so the receiving project's gate / reviewers
 * decide promotion rather than inheriting another project's decisions
 * wholesale.
 *
 * Each copy gets a deterministic target id derived from
 * `toProject + sourceNodeId`, so re-running is idempotent (already-present
 * copies are skipped). Lineage is preserved via `transferredFrom`
 * metadata and a `DERIVED_FROM` edge target -> source.
 */
export const transferVerifiedSkills = (
  deps: SkillTransferDeps,
  options: SkillTransferOptions,
): SkillTransferResult => {
  const result: SkillTransferResult = { transferred: 0, skipped: 0, targetNodeIds: [] };

  const sources = HIGH_ORDER_SUBSTRATES.flatMap((substrateType) =>
    deps.graphStore.listNodes({
      project: options.fromProject,
      substrateType,
      status: ContextNodeStatus.VERIFIED,
      limit: options.limit ?? 200,
    }),
  );

  for (const source of sources) {
    const targetId = transferredNodeId(options.toProject, source.id);
    if (deps.graphStore.getNodeById(targetId)) {
      result.skipped++;
      continue;
    }
    createTransferredNode(deps.graphStore, targetId, source, options.toProject);
    result.transferred++;
    result.targetNodeIds.push(targetId);
  }

  return result;
};

const createTransferredNode = (
  graphStore: ContextGraphStore,
  targetId: string,
  source: ContextNode,
  toProject: string,
): void => {
  graphStore.createNode({
    id: targetId,
    substrateType: source.substrateType,
    domainType: source.domainType,
    title: source.title,
    content: source.content,
    tags: dedupe([...(source.tags ?? []), 'transferred-skill']),
    project: toProject,
    compressionLevel: source.compressionLevel,
    confidence: source.confidence,
    qualityScore: source.qualityScore,
    status: ContextNodeStatus.CANDIDATE,
    metadata: {
      ...(source.metadata ?? {}),
      transferredFrom: source.id,
      transferredFromProject: source.project,
      transferredAt: new Date().toISOString(),
    },
  });

  try {
    graphStore.createEdge({
      id: `${targetId}->${source.id}:derived_from`,
      sourceId: targetId,
      targetId: source.id,
      relationType: ContextRelationType.DERIVED_FROM,
      strength: 1,
      evidence: { reason: 'cross-project-skill-transfer' },
    });
  } catch {
    // Source node may live in a different store instance; the metadata
    // lineage above is the durable record, so a missing-FK edge is non-fatal.
  }
};

const transferredNodeId = (toProject: string, sourceNodeId: string): string =>
  `transferred-skill:${toProject}:${shortHash(sourceNodeId)}`;

const shortHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 16);

const dedupe = (values: string[]): string[] => [...new Set(values)];
