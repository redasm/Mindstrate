import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  SkillEvolutionPatchStatus,
  type SkillEvolutionEvaluation,
  type SkillEvolutionEvaluator,
  type SkillEvolutionGateStatus,
  type SkillEvolutionMetric,
  type SkillEvolutionPatch,
  type SkillEvolutionPatchBudget,
  type SkillEvolutionPatchOperation,
} from '@mindstrate/protocol/models';

export interface CreateSkillEvolutionPatchInput {
  project?: string;
  sourceNodeId: string;
  targetNodeId?: string;
  operation: SkillEvolutionPatchOperation;
  beforeContent: string;
  afterContent: string;
  rationale: string;
  budget: SkillEvolutionPatchBudget;
  metadata?: Record<string, unknown>;
}

export interface ListSkillEvolutionPatchesOptions {
  project?: string;
  sourceNodeId?: string;
  status?: SkillEvolutionPatchStatus;
  limit?: number;
}

export interface CreateSkillEvolutionEvaluationInput {
  patchId: string;
  project?: string;
  evaluator: SkillEvolutionEvaluator;
  metric: SkillEvolutionMetric;
  baselineScore: number;
  candidateScore: number;
  accepted: boolean;
  status: SkillEvolutionGateStatus;
  details?: unknown;
}

export class SkillEvolutionStore {
  constructor(private readonly db: Database.Database) {
    initializeSkillEvolutionSchema(this.db);
  }

  createPatch(input: CreateSkillEvolutionPatchInput): SkillEvolutionPatch {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO skill_evolution_patches (
        id, project, source_node_id, target_node_id, operation,
        before_content, after_content, rationale, budget, status,
        created_at, decided_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      id,
      input.project ?? null,
      input.sourceNodeId,
      input.targetNodeId ?? null,
      input.operation,
      input.beforeContent,
      input.afterContent,
      input.rationale,
      JSON.stringify(input.budget),
      SkillEvolutionPatchStatus.CANDIDATE,
      createdAt,
      JSON.stringify(input.metadata ?? {}),
    );
    return this.getPatchById(id)!;
  }

  getPatchById(id: string): SkillEvolutionPatch | null {
    const row = this.db.prepare('SELECT * FROM skill_evolution_patches WHERE id = ?').get(id) as PatchRow | undefined;
    return row ? rowToPatch(row) : null;
  }

  listPatches(options: ListSkillEvolutionPatchesOptions = {}): SkillEvolutionPatch[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options.project) {
      conditions.push('LOWER(project) = LOWER(?)');
      params.push(options.project);
    }
    if (options.sourceNodeId) {
      conditions.push('source_node_id = ?');
      params.push(options.sourceNodeId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(options.limit ?? 100);
    const rows = this.db.prepare(`
      SELECT * FROM skill_evolution_patches
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...params) as PatchRow[];
    return rows.map(rowToPatch);
  }

  markPatchAccepted(id: string, metadata: Record<string, unknown> = {}): SkillEvolutionPatch | null {
    return this.updatePatchDecision(id, SkillEvolutionPatchStatus.ACCEPTED, metadata);
  }

  markPatchRejected(id: string, reason: string, metadata: Record<string, unknown> = {}): SkillEvolutionPatch | null {
    return this.updatePatchDecision(id, SkillEvolutionPatchStatus.REJECTED, {
      ...metadata,
      rejectionReason: reason,
    });
  }

  createEvaluation(input: CreateSkillEvolutionEvaluationInput): SkillEvolutionEvaluation {
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const delta = input.candidateScore - input.baselineScore;
    this.db.prepare(`
      INSERT INTO skill_evolution_evaluations (
        id, patch_id, project, evaluator, metric, baseline_score,
        candidate_score, delta, accepted, status, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.patchId,
      input.project ?? null,
      input.evaluator,
      input.metric,
      input.baselineScore,
      input.candidateScore,
      delta,
      input.accepted ? 1 : 0,
      input.status,
      JSON.stringify(input.details ?? null),
      createdAt,
    );
    return this.getEvaluationById(id)!;
  }

  getEvaluationById(id: string): SkillEvolutionEvaluation | null {
    const row = this.db.prepare('SELECT * FROM skill_evolution_evaluations WHERE id = ?').get(id) as EvaluationRow | undefined;
    return row ? rowToEvaluation(row) : null;
  }

  listEvaluations(patchId: string): SkillEvolutionEvaluation[] {
    const rows = this.db.prepare(`
      SELECT * FROM skill_evolution_evaluations
      WHERE patch_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(patchId) as EvaluationRow[];
    return rows.map(rowToEvaluation);
  }

  private updatePatchDecision(
    id: string,
    status: SkillEvolutionPatchStatus.ACCEPTED | SkillEvolutionPatchStatus.REJECTED,
    metadata: Record<string, unknown>,
  ): SkillEvolutionPatch | null {
    const existing = this.getPatchById(id);
    if (!existing) return null;
    const nextMetadata = {
      ...(existing.metadata ?? {}),
      ...metadata,
    };
    this.db.prepare(`
      UPDATE skill_evolution_patches
      SET status = ?, decided_at = ?, metadata = ?
      WHERE id = ?
    `).run(status, new Date().toISOString(), JSON.stringify(nextMetadata), id);
    return this.getPatchById(id);
  }
}

const initializeSkillEvolutionSchema = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_evolution_patches (
      id TEXT PRIMARY KEY,
      project TEXT,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT,
      operation TEXT NOT NULL,
      before_content TEXT NOT NULL,
      after_content TEXT NOT NULL,
      rationale TEXT NOT NULL,
      budget TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS skill_evolution_evaluations (
      id TEXT PRIMARY KEY,
      patch_id TEXT NOT NULL,
      project TEXT,
      evaluator TEXT NOT NULL,
      metric TEXT NOT NULL,
      baseline_score REAL NOT NULL,
      candidate_score REAL NOT NULL,
      delta REAL NOT NULL,
      accepted INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'rejected',
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(patch_id) REFERENCES skill_evolution_patches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_skill_evolution_patches_project
      ON skill_evolution_patches(project);
    CREATE INDEX IF NOT EXISTS idx_skill_evolution_patches_project_lower
      ON skill_evolution_patches(LOWER(project));
    CREATE INDEX IF NOT EXISTS idx_skill_evolution_patches_source
      ON skill_evolution_patches(source_node_id);
    CREATE INDEX IF NOT EXISTS idx_skill_evolution_patches_status
      ON skill_evolution_patches(status);
    CREATE INDEX IF NOT EXISTS idx_skill_evolution_evaluations_patch
      ON skill_evolution_evaluations(patch_id);
  `);
};

const rowToPatch = (row: PatchRow): SkillEvolutionPatch => ({
  id: row.id,
  project: row.project ?? undefined,
  sourceNodeId: row.source_node_id,
  targetNodeId: row.target_node_id ?? undefined,
  operation: row.operation as SkillEvolutionPatchOperation,
  beforeContent: row.before_content,
  afterContent: row.after_content,
  rationale: row.rationale,
  budget: JSON.parse(row.budget),
  status: row.status as SkillEvolutionPatchStatus,
  createdAt: row.created_at,
  decidedAt: row.decided_at ?? undefined,
  metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
});

const rowToEvaluation = (row: EvaluationRow): SkillEvolutionEvaluation => ({
  id: row.id,
  patchId: row.patch_id,
  project: row.project ?? undefined,
  evaluator: row.evaluator as SkillEvolutionEvaluator,
  metric: row.metric as SkillEvolutionMetric,
  baselineScore: row.baseline_score,
  candidateScore: row.candidate_score,
  delta: row.delta,
  accepted: row.accepted === 1,
  status: (row.status ?? (row.accepted === 1 ? 'accepted' : 'rejected')) as SkillEvolutionGateStatus,
  details: row.details ? JSON.parse(row.details) : undefined,
  createdAt: row.created_at,
});

interface PatchRow {
  id: string;
  project: string | null;
  source_node_id: string;
  target_node_id: string | null;
  operation: string;
  before_content: string;
  after_content: string;
  rationale: string;
  budget: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  metadata: string | null;
}

interface EvaluationRow {
  id: string;
  patch_id: string;
  project: string | null;
  evaluator: string;
  metric: string;
  baseline_score: number;
  candidate_score: number;
  delta: number;
  accepted: number;
  status: string | null;
  details: string | null;
  created_at: string;
}
