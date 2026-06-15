export enum SkillEvolutionPatchOperation {
  ADD = 'add',
  DELETE = 'delete',
  REPLACE = 'replace',
}

export enum SkillEvolutionPatchStatus {
  CANDIDATE = 'candidate',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export enum SkillEvolutionEvaluator {
  RETRIEVAL = 'retrieval',
  PROJECT_GRAPH = 'project_graph',
  TASK_HARNESS = 'task_harness',
}

export enum SkillEvolutionMetric {
  F1 = 'f1',
  MRR = 'mrr',
  ACCURACY = 'accuracy',
  SOFT_SCORE = 'soft_score',
  MIXED = 'mixed',
}

export enum SkillEvolutionGateStatus {
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  INSUFFICIENT_DATA = 'insufficient_data',
}

export interface SkillEvolutionPatchBudget {
  maxChangedBullets: number;
  maxChangedTokens: number;
}

export interface SkillEvolutionPatch {
  id: string;
  project?: string;
  sourceNodeId: string;
  targetNodeId?: string;
  operation: SkillEvolutionPatchOperation;
  beforeContent: string;
  afterContent: string;
  rationale: string;
  budget: SkillEvolutionPatchBudget;
  status: SkillEvolutionPatchStatus;
  createdAt: string;
  decidedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillEvolutionEvaluation {
  id: string;
  patchId: string;
  project?: string;
  evaluator: SkillEvolutionEvaluator;
  metric: SkillEvolutionMetric;
  baselineScore: number;
  candidateScore: number;
  delta: number;
  accepted: boolean;
  status: SkillEvolutionGateStatus;
  details?: unknown;
  createdAt: string;
}
