/**
 * Mindstrate - ECS Metabolism Models
 */

export enum MetabolismStage {
  DIGEST = 'digest',
  ASSIMILATE = 'assimilate',
  COMPRESS = 'compress',
  PRUNE = 'prune',
  REFLECT = 'reflect',
}

export enum MetabolismRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface MetabolismStageStats {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
}

export interface MetabolismRun {
  id: string;
  project?: string;
  trigger: 'manual' | 'scheduled' | 'event_driven';
  status: MetabolismRunStatus;
  startedAt: string;
  endedAt?: string;
  stageStats: Partial<Record<MetabolismStage, MetabolismStageStats>>;
  notes?: string[];
}

export interface ConflictRecord {
  id: string;
  project?: string;
  nodeIds: string[];
  reason: string;
  detectedAt: string;
  resolvedAt?: string;
  resolution?: string;
}

export enum ProjectionTarget {
  KNOWLEDGE_UNIT = 'knowledge_unit',
  SESSION_SUMMARY = 'session_summary',
  PROJECT_SNAPSHOT = 'project_snapshot',
  OBSIDIAN_DOCUMENT = 'obsidian_document',
}

export interface ProjectionRecord {
  id: string;
  nodeId: string;
  target: ProjectionTarget;
  targetRef: string;
  version: number;
  projectedAt: string;
}

export interface PortableContextBundle {
  id: string;
  name: string;
  version: string;
  description?: string;
  projectScoped: boolean;
  nodeIds: string[];
  edgeIds: string[];
  exportedAt: string;
}
