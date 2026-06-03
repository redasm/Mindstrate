import {
  ContextDomainType,
  ContextNodeStatus,
  SkillEvolutionPatchStatus,
  SubstrateType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { SkillEvolutionStore } from './skill-evolution-store.js';

export interface MetaSkillSynthesisDeps {
  graphStore: ContextGraphStore;
  evolutionStore: SkillEvolutionStore;
}

export interface MetaSkillSynthesisOptions {
  project?: string;
  /** Minimum accepted patches required before a meta-skill is worth synthesizing. Defaults to 3. */
  minAcceptedPatches?: number;
  /** Cap on rationales summarized into the meta-skill. Defaults to 20. */
  limit?: number;
}

export interface MetaSkillSynthesisResult {
  nodeId: string;
  acceptedPatchCount: number;
  created: boolean;
}

const META_SKILL_TAG = 'meta-skill';

/**
 * Meta-skill synthesis: summarize the rationales of accepted skill
 * evolution patches into a candidate HEURISTIC node that captures "how to
 * optimize Mindstrate skills". Candidate-first — it never auto-promotes;
 * the gate or a human decides. Idempotent: a deterministic id per project
 * means re-running refreshes the same node instead of multiplying it.
 */
export const synthesizeMetaSkill = (
  deps: MetaSkillSynthesisDeps,
  options: MetaSkillSynthesisOptions = {},
): MetaSkillSynthesisResult | null => {
  const minAccepted = options.minAcceptedPatches ?? 3;
  const limit = options.limit ?? 20;

  const accepted = deps.evolutionStore.listPatches({
    project: options.project,
    status: SkillEvolutionPatchStatus.ACCEPTED,
    limit: Math.max(limit * 4, minAccepted),
  });
  if (accepted.length < minAccepted) return null;

  const rationales = dedupe(accepted.map((patch) => patch.rationale.trim()).filter(Boolean)).slice(0, limit);
  const id = metaSkillId(options.project);
  const content = renderMetaSkillContent(rationales, accepted.length);
  const existing = deps.graphStore.getNodeById(id);

  if (existing) {
    deps.graphStore.updateNode(id, {
      content,
      status: ContextNodeStatus.CANDIDATE,
      metadata: { ...(existing.metadata ?? {}), metaSkill: true, acceptedPatchCount: accepted.length },
    });
    return { nodeId: id, acceptedPatchCount: accepted.length, created: false };
  }

  const node = createMetaSkillNode(deps.graphStore, id, options.project, content, accepted.length);
  return { nodeId: node.id, acceptedPatchCount: accepted.length, created: true };
};

const createMetaSkillNode = (
  graphStore: ContextGraphStore,
  id: string,
  project: string | undefined,
  content: string,
  acceptedPatchCount: number,
): ContextNode =>
  graphStore.createNode({
    id,
    substrateType: SubstrateType.HEURISTIC,
    domainType: ContextDomainType.BEST_PRACTICE,
    title: `Meta-skill: how to optimize ${project ?? 'global'} skills`,
    content,
    tags: [META_SKILL_TAG, 'skill-evolution'],
    project,
    compressionLevel: 0.002,
    confidence: 0.8,
    qualityScore: 84,
    status: ContextNodeStatus.CANDIDATE,
    metadata: { metaSkill: true, acceptedPatchCount },
  });

const renderMetaSkillContent = (rationales: string[], acceptedPatchCount: number): string => [
  `Synthesized from ${acceptedPatchCount} accepted skill evolution patches.`,
  'Recurring improvements that worked when optimizing skills:',
  '',
  ...rationales.map((rationale, index) => `${index + 1}. ${rationale}`),
].join('\n');

const metaSkillId = (project: string | undefined): string => `meta-skill:${project ?? 'global'}`;

const dedupe = (values: string[]): string[] => [...new Set(values)];
