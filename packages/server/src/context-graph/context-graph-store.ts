/**
 * Mindstrate - ECS Context Graph Store
 *
 * Minimal graph storage skeleton for the first ECS migration stage.
 * The existing KnowledgeUnit store remains in place; this store provides a
 * stable landing zone for graph-native nodes, edges and events.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  ContextEdge,
  ContextEvent,
  ContextNode,
} from '@mindstrate/protocol/models';
import {
  type ConflictRecord,
  type MetabolismRun,
  type ProjectionRecord,
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';

type DbHandle = Database.Database | string;

export interface CreateContextNodeInput {
  id?: string;
  substrateType: SubstrateType;
  domainType: ContextDomainType;
  title: string;
  content: string;
  tags?: string[];
  project?: string;
  compressionLevel?: number;
  confidence?: number;
  qualityScore?: number;
  status?: ContextNodeStatus;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContextNodeInput {
  title?: string;
  content?: string;
  tags?: string[];
  project?: string;
  compressionLevel?: number;
  confidence?: number;
  qualityScore?: number;
  status?: ContextNodeStatus;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
  lastAccessedAt?: string;
  accessCount?: number;
  positiveFeedback?: number;
  negativeFeedback?: number;
}

export interface CreateContextEdgeInput {
  id?: string;
  sourceId: string;
  targetId: string;
  relationType: ContextRelationType;
  strength?: number;
  evidence?: Record<string, unknown>;
}

export interface CreateContextEventInput {
  id?: string;
  type: ContextEventType;
  project?: string;
  sessionId?: string;
  actor?: string;
  content: string;
  metadata?: Record<string, unknown>;
  observedAt?: string;
}

export interface NodeEmbeddingRecord {
  nodeId: string;
  model: string;
  dimensions: number;
  embedding: number[];
  text?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertNodeEmbeddingInput {
  nodeId: string;
  model: string;
  dimensions: number;
  embedding: number[];
  text?: string;
}

export class ContextGraphStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;

  constructor(dbOrPath: DbHandle) {
    if (typeof dbOrPath === 'string') {
      const dir = path.dirname(dbOrPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(dbOrPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.ownsDb = true;
    } else {
      this.db = dbOrPath;
      this.ownsDb = false;
    }

    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS context_nodes (
        id TEXT PRIMARY KEY,
        substrate_type TEXT NOT NULL,
        domain_type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        project TEXT,
        compression_level REAL NOT NULL DEFAULT 1.0,
        confidence REAL NOT NULL DEFAULT 0.5,
        quality_score REAL NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'candidate',
        source_ref TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        positive_feedback INTEGER NOT NULL DEFAULT 0,
        negative_feedback INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS context_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        evidence TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(source_id) REFERENCES context_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY(target_id) REFERENCES context_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS context_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project TEXT,
        session_id TEXT,
        actor TEXT,
        content TEXT NOT NULL,
        metadata TEXT,
        observed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_embeddings (
        node_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding TEXT NOT NULL,
        text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (node_id, model),
        FOREIGN KEY(node_id) REFERENCES context_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conflict_records (
        id TEXT PRIMARY KEY,
        project TEXT,
        node_ids TEXT NOT NULL,
        reason TEXT NOT NULL,
        detected_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT
      );

      CREATE TABLE IF NOT EXISTS projection_records (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        target TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        version INTEGER NOT NULL,
        projected_at TEXT NOT NULL,
        FOREIGN KEY(node_id) REFERENCES context_nodes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS metabolism_runs (
        id TEXT PRIMARY KEY,
        project TEXT,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        stage_stats TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_context_nodes_project ON context_nodes(project);
      CREATE INDEX IF NOT EXISTS idx_context_nodes_substrate_type ON context_nodes(substrate_type);
      CREATE INDEX IF NOT EXISTS idx_context_nodes_domain_type ON context_nodes(domain_type);
      CREATE INDEX IF NOT EXISTS idx_context_nodes_status ON context_nodes(status);
      CREATE INDEX IF NOT EXISTS idx_context_edges_source ON context_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_context_edges_target ON context_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_context_edges_relation_type ON context_edges(relation_type);
      CREATE INDEX IF NOT EXISTS idx_context_events_project ON context_events(project);
      CREATE INDEX IF NOT EXISTS idx_context_events_type ON context_events(type);
      CREATE INDEX IF NOT EXISTS idx_context_events_observed_at ON context_events(observed_at);
      CREATE INDEX IF NOT EXISTS idx_node_embeddings_model ON node_embeddings(model);
      CREATE INDEX IF NOT EXISTS idx_conflict_records_project ON conflict_records(project);
      CREATE INDEX IF NOT EXISTS idx_conflict_records_detected_at ON conflict_records(detected_at);
      CREATE INDEX IF NOT EXISTS idx_projection_records_node_id ON projection_records(node_id);
      CREATE INDEX IF NOT EXISTS idx_projection_records_target ON projection_records(target);
      CREATE INDEX IF NOT EXISTS idx_metabolism_runs_project ON metabolism_runs(project);
      CREATE INDEX IF NOT EXISTS idx_metabolism_runs_started_at ON metabolism_runs(started_at);
    `);
  }

  createNode(input: CreateContextNodeInput): ContextNode {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();

    this.db.prepare(`
      INSERT INTO context_nodes (
        id, substrate_type, domain_type, title, content, tags, project,
        compression_level, confidence, quality_score, status, source_ref,
        metadata, created_at, updated_at, last_accessed_at, access_count,
        positive_feedback, negative_feedback
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, NULL, 0,
        0, 0
      )
    `).run(
      id,
      input.substrateType,
      input.domainType,
      input.title,
      input.content,
      JSON.stringify(input.tags ?? []),
      input.project ?? null,
      input.compressionLevel ?? 1,
      input.confidence ?? 0.5,
      input.qualityScore ?? 50,
      input.status ?? ContextNodeStatus.CANDIDATE,
      input.sourceRef ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
      now,
    );

    return this.getNodeById(id)!;
  }

  getNodeById(id: string): ContextNode | null {
    const row = this.db.prepare('SELECT * FROM context_nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? this.rowToNode(row) : null;
  }

  listNodes(options: {
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    sourceRef?: string;
    limit?: number;
  } = {}): ContextNode[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }
    if (options.substrateType) {
      conditions.push('substrate_type = ?');
      params.push(options.substrateType);
    }
    if (options.domainType) {
      conditions.push('domain_type = ?');
      params.push(options.domainType);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.sourceRef) {
      conditions.push('source_ref = ?');
      params.push(options.sourceRef);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_nodes ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map((row) => this.rowToNode(row));
  }

  updateNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    const existing = this.getNodeById(id);
    if (!existing) return null;

    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];

    if (input.title !== undefined) {
      sets.push('title = ?');
      params.push(input.title);
    }
    if (input.content !== undefined) {
      sets.push('content = ?');
      params.push(input.content);
    }
    if (input.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(input.tags));
    }
    if (input.project !== undefined) {
      sets.push('project = ?');
      params.push(input.project);
    }
    if (input.compressionLevel !== undefined) {
      sets.push('compression_level = ?');
      params.push(input.compressionLevel);
    }
    if (input.confidence !== undefined) {
      sets.push('confidence = ?');
      params.push(input.confidence);
    }
    if (input.qualityScore !== undefined) {
      sets.push('quality_score = ?');
      params.push(input.qualityScore);
    }
    if (input.status !== undefined) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (input.sourceRef !== undefined) {
      sets.push('source_ref = ?');
      params.push(input.sourceRef);
    }
    if (input.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(JSON.stringify(input.metadata));
    }
    if (input.lastAccessedAt !== undefined) {
      sets.push('last_accessed_at = ?');
      params.push(input.lastAccessedAt);
    }
    if (input.accessCount !== undefined) {
      sets.push('access_count = ?');
      params.push(input.accessCount);
    }
    if (input.positiveFeedback !== undefined) {
      sets.push('positive_feedback = ?');
      params.push(input.positiveFeedback);
    }
    if (input.negativeFeedback !== undefined) {
      sets.push('negative_feedback = ?');
      params.push(input.negativeFeedback);
    }

    params.push(id);
    this.db.prepare(`UPDATE context_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getNodeById(id);
  }

  deleteNode(id: string): boolean {
    const result = this.db.prepare('DELETE FROM context_nodes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  recordNodeAccess(id: string, accessedAt = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE context_nodes
      SET access_count = access_count + 1,
          last_accessed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(accessedAt, accessedAt, id);
  }

  createEdge(input: CreateContextEdgeInput): ContextEdge {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();

    this.db.prepare(`
      INSERT INTO context_edges (
        id, source_id, target_id, relation_type, strength, evidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceId,
      input.targetId,
      input.relationType,
      input.strength ?? 1,
      input.evidence ? JSON.stringify(input.evidence) : null,
      now,
      now,
    );

    return this.getEdgeById(id)!;
  }

  getEdgeById(id: string): ContextEdge | null {
    const row = this.db.prepare('SELECT * FROM context_edges WHERE id = ?').get(id) as EdgeRow | undefined;
    return row ? this.rowToEdge(row) : null;
  }

  listOutgoingEdges(sourceId: string, relationType?: ContextRelationType): ContextEdge[] {
    const rows = relationType
      ? this.db.prepare(
        'SELECT * FROM context_edges WHERE source_id = ? AND relation_type = ? ORDER BY updated_at DESC',
      ).all(sourceId, relationType) as EdgeRow[]
      : this.db.prepare(
        'SELECT * FROM context_edges WHERE source_id = ? ORDER BY updated_at DESC',
      ).all(sourceId) as EdgeRow[];

    return rows.map((row) => this.rowToEdge(row));
  }

  listIncomingEdges(targetId: string, relationType?: ContextRelationType): ContextEdge[] {
    const rows = relationType
      ? this.db.prepare(
        'SELECT * FROM context_edges WHERE target_id = ? AND relation_type = ? ORDER BY updated_at DESC',
      ).all(targetId, relationType) as EdgeRow[]
      : this.db.prepare(
        'SELECT * FROM context_edges WHERE target_id = ? ORDER BY updated_at DESC',
      ).all(targetId) as EdgeRow[];

    return rows.map((row) => this.rowToEdge(row));
  }

  listEdges(options: {
    sourceId?: string;
    targetId?: string;
    relationType?: ContextRelationType;
    limit?: number;
  } = {}): ContextEdge[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.sourceId) {
      conditions.push('source_id = ?');
      params.push(options.sourceId);
    }
    if (options.targetId) {
      conditions.push('target_id = ?');
      params.push(options.targetId);
    }
    if (options.relationType) {
      conditions.push('relation_type = ?');
      params.push(options.relationType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_edges ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(options.limit ?? 500);

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map((row) => this.rowToEdge(row));
  }

  createEvent(input: CreateContextEventInput): ContextEvent {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const observedAt = input.observedAt ?? now;

    this.db.prepare(`
      INSERT INTO context_events (
        id, type, project, session_id, actor, content, metadata, observed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.project ?? null,
      input.sessionId ?? null,
      input.actor ?? null,
      input.content,
      input.metadata ? JSON.stringify(input.metadata) : null,
      observedAt,
      now,
    );

    return this.getEventById(id)!;
  }

  getEventById(id: string): ContextEvent | null {
    const row = this.db.prepare('SELECT * FROM context_events WHERE id = ?').get(id) as EventRow | undefined;
    return row ? this.rowToEvent(row) : null;
  }

  listEvents(options: { project?: string; type?: ContextEventType; limit?: number } = {}): ContextEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_events ${where} ORDER BY observed_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map((row) => this.rowToEvent(row));
  }

  upsertNodeEmbedding(input: UpsertNodeEmbeddingInput): NodeEmbeddingRecord {
    const existing = this.getNodeEmbedding(input.nodeId, input.model);
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? now;

    this.db.prepare(`
      INSERT INTO node_embeddings (
        node_id, model, dimensions, embedding, text, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id, model) DO UPDATE SET
        dimensions = excluded.dimensions,
        embedding = excluded.embedding,
        text = excluded.text,
        updated_at = excluded.updated_at
    `).run(
      input.nodeId,
      input.model,
      input.dimensions,
      JSON.stringify(input.embedding),
      input.text ?? null,
      createdAt,
      now,
    );

    return this.getNodeEmbedding(input.nodeId, input.model)!;
  }

  getNodeEmbedding(nodeId: string, model: string): NodeEmbeddingRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM node_embeddings WHERE node_id = ? AND model = ?
    `).get(nodeId, model) as NodeEmbeddingRow | undefined;
    return row ? this.rowToNodeEmbedding(row) : null;
  }

  createConflictRecord(input: {
    id?: string;
    project?: string;
    nodeIds: string[];
    reason: string;
    detectedAt?: string;
  }): ConflictRecord {
    const id = input.id ?? uuidv4();
    const detectedAt = input.detectedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO conflict_records (
        id, project, node_ids, reason, detected_at, resolved_at, resolution
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      id,
      input.project ?? null,
      JSON.stringify(input.nodeIds),
      input.reason,
      detectedAt,
    );

    return this.getConflictRecordById(id)!;
  }

  getConflictRecordById(id: string): ConflictRecord | null {
    const row = this.db.prepare('SELECT * FROM conflict_records WHERE id = ?').get(id) as ConflictRow | undefined;
    return row ? this.rowToConflict(row) : null;
  }

  resolveConflictRecord(id: string, resolution: string, resolvedAt: string = new Date().toISOString()): ConflictRecord | null {
    const existing = this.getConflictRecordById(id);
    if (!existing) return null;

    this.db.prepare(`
      UPDATE conflict_records
      SET resolved_at = ?, resolution = ?
      WHERE id = ?
    `).run(resolvedAt, resolution, id);

    return this.getConflictRecordById(id);
  }

  listConflictRecords(options: { project?: string; limit?: number } = {}): ConflictRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM conflict_records ${where} ORDER BY detected_at DESC LIMIT ?`;
    params.push(options.limit ?? 200);

    const rows = this.db.prepare(sql).all(...params) as ConflictRow[];
    return rows.map((row) => this.rowToConflict(row));
  }

  upsertProjectionRecord(input: {
    id?: string;
    nodeId: string;
    target: string;
    targetRef: string;
    version: number;
    projectedAt?: string;
  }): ProjectionRecord {
    const id = input.id ?? uuidv4();
    const projectedAt = input.projectedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO projection_records (id, node_id, target, target_ref, version, projected_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        node_id = excluded.node_id,
        target = excluded.target,
        target_ref = excluded.target_ref,
        version = excluded.version,
        projected_at = excluded.projected_at
    `).run(id, input.nodeId, input.target, input.targetRef, input.version, projectedAt);

    return this.getProjectionRecordById(id)!;
  }

  getProjectionRecordById(id: string): ProjectionRecord | null {
    const row = this.db.prepare('SELECT * FROM projection_records WHERE id = ?').get(id) as ProjectionRow | undefined;
    return row ? this.rowToProjection(row) : null;
  }

  listProjectionRecords(options: { nodeId?: string; target?: string; limit?: number } = {}): ProjectionRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.nodeId) {
      conditions.push('node_id = ?');
      params.push(options.nodeId);
    }
    if (options.target) {
      conditions.push('target = ?');
      params.push(options.target);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM projection_records ${where} ORDER BY projected_at DESC LIMIT ?`;
    params.push(options.limit ?? 200);

    const rows = this.db.prepare(sql).all(...params) as ProjectionRow[];
    return rows.map((row) => this.rowToProjection(row));
  }

  createMetabolismRun(input: {
    id?: string;
    project?: string;
    trigger: string;
    status: string;
    startedAt?: string;
    stageStats?: Record<string, unknown>;
    notes?: string[];
  }): MetabolismRun {
    const id = input.id ?? uuidv4();
    const startedAt = input.startedAt ?? new Date().toISOString();

    this.db.prepare(`
      INSERT INTO metabolism_runs (
        id, project, trigger_type, status, started_at, ended_at, stage_stats, notes
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      input.project ?? null,
      input.trigger,
      input.status,
      startedAt,
      JSON.stringify(input.stageStats ?? {}),
      JSON.stringify(input.notes ?? []),
    );

    return this.getMetabolismRunById(id)!;
  }

  updateMetabolismRun(id: string, input: {
    status?: string;
    endedAt?: string;
    stageStats?: Record<string, unknown>;
    notes?: string[];
  }): MetabolismRun | null {
    const existing = this.getMetabolismRunById(id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined) {
      sets.push('status = ?');
      params.push(input.status);
    }
    if (input.endedAt !== undefined) {
      sets.push('ended_at = ?');
      params.push(input.endedAt);
    }
    if (input.stageStats !== undefined) {
      sets.push('stage_stats = ?');
      params.push(JSON.stringify(input.stageStats));
    }
    if (input.notes !== undefined) {
      sets.push('notes = ?');
      params.push(JSON.stringify(input.notes));
    }

    if (sets.length === 0) return existing;

    params.push(id);
    this.db.prepare(`UPDATE metabolism_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getMetabolismRunById(id);
  }

  getMetabolismRunById(id: string): MetabolismRun | null {
    const row = this.db.prepare('SELECT * FROM metabolism_runs WHERE id = ?').get(id) as MetabolismRow | undefined;
    return row ? this.rowToMetabolismRun(row) : null;
  }

  listMetabolismRuns(options: { project?: string; limit?: number } = {}): MetabolismRun[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      conditions.push('project = ?');
      params.push(options.project);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM metabolism_runs ${where} ORDER BY started_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as MetabolismRow[];
    return rows.map((row) => this.rowToMetabolismRun(row));
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  private rowToNode(row: NodeRow): ContextNode {
    return {
      id: row.id,
      substrateType: row.substrate_type,
      domainType: row.domain_type,
      title: row.title,
      content: row.content,
      tags: JSON.parse(row.tags),
      project: row.project ?? undefined,
      compressionLevel: row.compression_level,
      confidence: row.confidence,
      qualityScore: row.quality_score,
      status: row.status,
      sourceRef: row.source_ref ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at ?? undefined,
      accessCount: row.access_count,
      positiveFeedback: row.positive_feedback,
      negativeFeedback: row.negative_feedback,
    };
  }

  private rowToEdge(row: EdgeRow): ContextEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relationType: row.relation_type,
      strength: row.strength,
      evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToEvent(row: EventRow): ContextEvent {
    return {
      id: row.id,
      type: row.type,
      project: row.project ?? undefined,
      sessionId: row.session_id ?? undefined,
      actor: row.actor ?? undefined,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      observedAt: row.observed_at,
      createdAt: row.created_at,
    };
  }

  private rowToNodeEmbedding(row: NodeEmbeddingRow): NodeEmbeddingRecord {
    return {
      nodeId: row.node_id,
      model: row.model,
      dimensions: row.dimensions,
      embedding: JSON.parse(row.embedding),
      text: row.text ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToConflict(row: ConflictRow): ConflictRecord {
    return {
      id: row.id,
      project: row.project ?? undefined,
      nodeIds: JSON.parse(row.node_ids),
      reason: row.reason,
      detectedAt: row.detected_at,
      resolvedAt: row.resolved_at ?? undefined,
      resolution: row.resolution ?? undefined,
    };
  }

  private rowToProjection(row: ProjectionRow): ProjectionRecord {
    return {
      id: row.id,
      nodeId: row.node_id,
      target: row.target as ProjectionRecord['target'],
      targetRef: row.target_ref,
      version: row.version,
      projectedAt: row.projected_at,
    };
  }

  private rowToMetabolismRun(row: MetabolismRow): MetabolismRun {
    return {
      id: row.id,
      project: row.project ?? undefined,
      trigger: row.trigger_type as MetabolismRun['trigger'],
      status: row.status as MetabolismRun['status'],
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      stageStats: JSON.parse(row.stage_stats),
      notes: JSON.parse(row.notes),
    };
  }
}

interface NodeRow {
  id: string;
  substrate_type: SubstrateType;
  domain_type: ContextDomainType;
  title: string;
  content: string;
  tags: string;
  project: string | null;
  compression_level: number;
  confidence: number;
  quality_score: number;
  status: ContextNodeStatus;
  source_ref: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  access_count: number;
  positive_feedback: number;
  negative_feedback: number;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation_type: ContextRelationType;
  strength: number;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  type: ContextEventType;
  project: string | null;
  session_id: string | null;
  actor: string | null;
  content: string;
  metadata: string | null;
  observed_at: string;
  created_at: string;
}

interface NodeEmbeddingRow {
  node_id: string;
  model: string;
  dimensions: number;
  embedding: string;
  text: string | null;
  created_at: string;
  updated_at: string;
}

interface ConflictRow {
  id: string;
  project: string | null;
  node_ids: string;
  reason: string;
  detected_at: string;
  resolved_at: string | null;
  resolution: string | null;
}

interface ProjectionRow {
  id: string;
  node_id: string;
  target: string;
  target_ref: string;
  version: number;
  projected_at: string;
}

interface MetabolismRow {
  id: string;
  project: string | null;
  trigger_type: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  stage_stats: string;
  notes: string;
}
