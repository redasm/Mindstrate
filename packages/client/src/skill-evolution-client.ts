import type {
  ProjectionRecord,
  SkillEvolutionEvaluation,
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  SkillEvolutionPatch,
  SkillEvolutionPatchStatus,
} from '@mindstrate/protocol';
import { TeamDomainClient } from './team-domain-client.js';

export interface BestSkillArtifactResponse {
  markdown: string;
  records: ProjectionRecord[];
  sourceNodeIds: string[];
}

export interface SkillOptimizationResult {
  nodeId: string;
  outcome: string;
  patchId?: string;
  evaluationId?: string;
}

export interface SkillTransferResult {
  transferred: number;
  skipped: number;
  targetNodeIds: string[];
}

export class SkillEvolutionClient extends TeamDomainClient {
  async transferVerifiedSkills(input: { fromProject: string; toProject: string; limit?: number }): Promise<SkillTransferResult> {
    return this.post<SkillTransferResult>('/api/skill-evolution/transfer', input);
  }

  async optimizeTargets(options?: { project?: string; limit?: number }): Promise<SkillOptimizationResult[]> {
    const response = await this.post<{ results: SkillOptimizationResult[] }>(
      '/api/skill-evolution/optimize',
      { project: options?.project, limit: options?.limit },
    );
    return response.results;
  }

  async renderBestSkillArtifact(options?: { project?: string; limit?: number }): Promise<BestSkillArtifactResponse> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return this.fetch<BestSkillArtifactResponse>(
      `/api/skill-evolution/best-skill${query ? `?${query}` : ''}`,
    );
  }

  async listPatches(options?: {
    project?: string;
    sourceNodeId?: string;
    status?: SkillEvolutionPatchStatus;
    limit?: number;
  }): Promise<SkillEvolutionPatch[]> {
    const params = new URLSearchParams();
    if (options?.project) params.set('project', options.project);
    if (options?.sourceNodeId) params.set('sourceNodeId', options.sourceNodeId);
    if (options?.status) params.set('status', options.status);
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    const response = await this.fetch<{ patches: SkillEvolutionPatch[] }>(
      `/api/skill-evolution/patches${query ? `?${query}` : ''}`,
    );
    return response.patches;
  }

  async getPatch(id: string): Promise<SkillEvolutionPatch | null> {
    return this.fetch<SkillEvolutionPatch | null>(`/api/skill-evolution/patches/${encodeURIComponent(id)}`);
  }

  async evaluatePatch(input: {
    patchId: string;
    evaluator: SkillEvolutionEvaluator;
    metric: SkillEvolutionMetric;
    baselineScore: number;
    candidateScore: number;
    details?: unknown;
  }): Promise<SkillEvolutionEvaluation> {
    return this.post(
      `/api/skill-evolution/patches/${encodeURIComponent(input.patchId)}/evaluate`,
      {
        evaluator: input.evaluator,
        metric: input.metric,
        baselineScore: input.baselineScore,
        candidateScore: input.candidateScore,
        details: input.details,
      },
    );
  }

  async rejectPatch(input: {
    patchId: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<SkillEvolutionPatch | null> {
    return this.post(
      `/api/skill-evolution/patches/${encodeURIComponent(input.patchId)}/reject`,
      { reason: input.reason, metadata: input.metadata },
    );
  }
}
