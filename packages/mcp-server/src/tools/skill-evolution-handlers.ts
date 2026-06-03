import type { McpApi, McpToolResponse } from '../types.js';
import { assertProjectAllowed } from '../allowed-projects.js';
import type {
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  SkillEvolutionPatchStatus,
} from '@mindstrate/protocol';

type ToolInput = any;

export async function handleSkillEvolutionListPatches(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.project);
  const patches = await api.listSkillPatches({
    project: input.project,
    sourceNodeId: input.sourceNodeId,
    status: input.status as SkillEvolutionPatchStatus | undefined,
    limit: input.limit,
  });

  if (patches.length === 0) {
    return { content: [{ type: 'text', text: 'No skill evolution patches found.' }] };
  }

  const lines = patches.map((patch) =>
    `- ${patch.id} [${patch.status}] ${patch.operation} on ${patch.sourceNodeId}: ${patch.rationale}`,
  );
  return {
    content: [{
      type: 'text',
      text: `Skill evolution patches (${patches.length}):\n${lines.join('\n')}`,
    }],
  };
}

export async function handleSkillEvolutionGetPatch(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const patch = await api.getSkillPatch(input.id);
  if (!patch) {
    return { content: [{ type: 'text', text: `Patch not found: ${input.id}` }], isError: true };
  }
  assertProjectAllowed(patch.project);
  return {
    content: [{ type: 'text', text: JSON.stringify(patch, null, 2) }],
  };
}

export async function handleSkillEvolutionEvaluatePatch(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const patch = await api.getSkillPatch(input.patchId);
  if (!patch) {
    return { content: [{ type: 'text', text: `Patch not found: ${input.patchId}` }], isError: true };
  }
  assertProjectAllowed(patch.project);

  const evaluation = await api.evaluateSkillPatch({
    patchId: input.patchId,
    evaluator: (input.evaluator ?? 'retrieval') as SkillEvolutionEvaluator,
    metric: (input.metric ?? 'f1') as SkillEvolutionMetric,
    baselineScore: input.baselineScore,
    candidateScore: input.candidateScore,
    details: input.details,
  });

  return {
    content: [{
      type: 'text',
      text: [
        `Skill patch ${evaluation.patchId} evaluated.`,
        `Accepted: ${evaluation.accepted}`,
        `Delta: ${evaluation.delta.toFixed(4)} (baseline ${evaluation.baselineScore} -> candidate ${evaluation.candidateScore})`,
      ].join('\n'),
    }],
  };
}

export async function handleSkillEvolutionRejectPatch(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  const patch = await api.getSkillPatch(input.patchId);
  if (!patch) {
    return { content: [{ type: 'text', text: `Patch not found: ${input.patchId}` }], isError: true };
  }
  assertProjectAllowed(patch.project);

  const rejected = await api.rejectSkillPatch({ patchId: input.patchId, reason: input.reason });
  return {
    content: [{
      type: 'text',
      text: rejected
        ? `Skill patch ${rejected.id} rejected: ${input.reason}`
        : `Failed to reject patch ${input.patchId}`,
    }],
    isError: !rejected,
  };
}

export async function handleSkillEvolutionRenderBestSkill(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.project);
  const artifact = await api.renderBestSkillArtifact({ project: input.project, limit: input.limit });
  if (artifact.sourceNodeIds.length === 0) {
    return { content: [{ type: 'text', text: 'No verified skill nodes available to render a best-skill artifact.' }] };
  }
  return {
    content: [{ type: 'text', text: artifact.markdown }],
  };
}

export async function handleSkillEvolutionOptimize(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.project);
  const results = await api.optimizeSkillTargets({ project: input.project, limit: input.limit });
  if (results.length === 0) {
    return { content: [{ type: 'text', text: 'No skill optimization targets found.' }] };
  }
  const lines = results.map((r) => `- ${r.nodeId}: ${r.outcome}${r.patchId ? ` (patch ${r.patchId})` : ''}`);
  return {
    content: [{
      type: 'text',
      text: `Skill optimization run over ${results.length} target(s):\n${lines.join('\n')}`,
    }],
  };
}

export async function handleSkillEvolutionTransfer(
  api: McpApi,
  input: ToolInput,
): Promise<McpToolResponse> {
  assertProjectAllowed(input.fromProject);
  assertProjectAllowed(input.toProject);
  const result = await api.transferVerifiedSkills({
    fromProject: input.fromProject,
    toProject: input.toProject,
    limit: input.limit,
  });
  return {
    content: [{
      type: 'text',
      text: `Transferred ${result.transferred} verified skill(s) from ${input.fromProject} to ${input.toProject} as candidates (skipped ${result.skipped} already present).`,
    }],
  };
}
