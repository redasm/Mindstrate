/**
 * Mindstrate - ECS Context Graph Store
 *
 * Graph-native storage for ECS nodes, edges, events and projections.
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
  ContextEventType,
  ContextRelationType,
} from '@mindstrate/protocol/models';
import {
  ContextEdgeRepository,
  type CreateContextEdgeInput,
  type ListContextEdgesOptions,
} from './context-edge-repository.js';
import {
  ContextNodeRepository,
  type CreateContextNodeInput,
  type ListContextNodesOptions,
  type UpdateContextNodeInput,
} from './context-node-repository.js';
import {
  ConflictRecordRepository,
  ProjectionRecordRepository,
  type CreateConflictRecordInput,
  type ListConflictRecordsOptions,
  type ListProjectionRecordsOptions,
  type UpsertProjectionRecordInput,
} from './context-record-repositories.js';
import { GraphQuery } from './graph-query.js';

type DbHandle = Database.Database | string;

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

export type {
  CreateContextEdgeInput,
  CreateContextNodeInput,
  ListContextEdgesOptions,
  ListContextNodesOptions,
  UpdateContextNodeInput,
};

export class ContextGraphStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly nodes: ContextNodeRepository;
  private readonly edges: ContextEdgeRepository;
  private readonly conflictRecords: ConflictRecordRepository;
  private readonly projectionRecords: ProjectionRecordRepository;

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
    this.nodes = new ContextNodeRepository(this.db);
    this.edges = new ContextEdgeRepository(this.db);
    this.conflictRecords = new ConflictRecordRepository(this.db);
    this.projectionRecords = new ProjectionRecordRepository(this.db);
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
    return this.nodes.create(input);
  }

  getNodeById(id: string): ContextNode | null {
    return this.nodes.getById(id);
  }

  listNodes(options: ListContextNodesOptions = {}): ContextNode[] {
    return this.nodes.list(options);
  }

  updateNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.nodes.update(id, input);
  }

  deleteNode(id: string): boolean {
    return this.nodes.delete(id);
  }

  recordNodeAccess(id: string, accessedAt = new Date().toISOString()): void {
    this.nodes.recordAccess(id, accessedAt);
  }

  createGraphQuery(): GraphQuery {
    return new GraphQuery(this.nodes, this.edges);
  }

  createEdge(input: CreateContextEdgeInput): ContextEdge {
    return this.edges.create(input);
  }

  getEdgeById(id: string): ContextEdge | null {
    return this.edges.getById(id);
  }

  listOutgoingEdges(sourceId: string, relationType?: ContextRelationType): ContextEdge[] {
    return this.edges.listOutgoing(sourceId, relationType);
  }

  listIncomingEdges(targetId: string, relationType?: ContextRelationType): ContextEdge[] {
    return this.edges.listIncoming(targetId, relationType);
  }

  listEdges(options: ListContextEdgesOptions = {}): ContextEdge[] {
    return this.edges.list(options);
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

  createConflictRecord(input: CreateConflictRecordInput): ConflictRecord {
    return this.conflictRecords.create(input);
  }

  getConflictRecordById(id: string): ConflictRecord | null {
    return this.conflictRecords.getById(id);
  }

  resolveConflictRecord(id: string, resolution: string, resolvedAt: string = new Date().toISOString()): ConflictRecord | null {
    return this.conflictRecords.resolve(id, resolution, resolvedAt);
  }

  listConflictRecords(options: ListConflictRecordsOptions = {}): ConflictRecord[] {
    return this.conflictRecords.list(options);
  }

  upsertProjectionRecord(input: UpsertProjectionRecordInput): ProjectionRecord {
    return this.projectionRecords.upsert(input);
  }

  getProjectionRecordById(id: string): ProjectionRecord | null {
    return this.projectionRecords.getById(id);
  }

  listProjectionRecords(options: ListProjectionRecordsOptions = {}): ProjectionRecord[] {
    return this.projectionRecords.list(options);
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
