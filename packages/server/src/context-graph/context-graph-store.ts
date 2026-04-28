/**
 * Mindstrate - ECS Context Graph Store
 *
 * Graph-native storage for ECS nodes, edges, events and projections.
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ContextEdge,
  ContextEvent,
  ContextNode,
} from '@mindstrate/protocol/models';
import {
  type ConflictRecord,
  type MetabolismRun,
  type ProjectionRecord,
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
  ContextEventRepository,
  type CreateContextEventInput,
  type ListContextEventsOptions,
} from './context-event-repository.js';
import {
  NodeEmbeddingRepository,
  type NodeEmbeddingRecord,
  type UpsertNodeEmbeddingInput,
} from './node-embedding-repository.js';
import {
  MetabolismRunRepository,
  type CreateMetabolismRunInput,
  type ListMetabolismRunsOptions,
  type UpdateMetabolismRunInput,
} from './metabolism-run-repository.js';
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

export type {
  CreateContextEdgeInput,
  CreateContextEventInput,
  CreateMetabolismRunInput,
  CreateContextNodeInput,
  ListContextEdgesOptions,
  ListContextEventsOptions,
  ListMetabolismRunsOptions,
  ListContextNodesOptions,
  NodeEmbeddingRecord,
  UpdateMetabolismRunInput,
  UpdateContextNodeInput,
  UpsertNodeEmbeddingInput,
};

export class ContextGraphStore {
  private readonly db: Database.Database;
  private readonly ownsDb: boolean;
  private readonly nodes: ContextNodeRepository;
  private readonly edges: ContextEdgeRepository;
  private readonly events: ContextEventRepository;
  private readonly nodeEmbeddings: NodeEmbeddingRepository;
  private readonly conflictRecords: ConflictRecordRepository;
  private readonly projectionRecords: ProjectionRecordRepository;
  private readonly metabolismRuns: MetabolismRunRepository;

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
    this.events = new ContextEventRepository(this.db);
    this.nodeEmbeddings = new NodeEmbeddingRepository(this.db);
    this.conflictRecords = new ConflictRecordRepository(this.db);
    this.projectionRecords = new ProjectionRecordRepository(this.db);
    this.metabolismRuns = new MetabolismRunRepository(this.db);
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
    return this.events.create(input);
  }

  getEventById(id: string): ContextEvent | null {
    return this.events.getById(id);
  }

  listEvents(options: ListContextEventsOptions = {}): ContextEvent[] {
    return this.events.list(options);
  }

  upsertNodeEmbedding(input: UpsertNodeEmbeddingInput): NodeEmbeddingRecord {
    return this.nodeEmbeddings.upsert(input);
  }

  getNodeEmbedding(nodeId: string, model: string): NodeEmbeddingRecord | null {
    return this.nodeEmbeddings.get(nodeId, model);
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

  createMetabolismRun(input: CreateMetabolismRunInput): MetabolismRun {
    return this.metabolismRuns.create(input);
  }

  updateMetabolismRun(id: string, input: UpdateMetabolismRunInput): MetabolismRun | null {
    return this.metabolismRuns.update(id, input);
  }

  getMetabolismRunById(id: string): MetabolismRun | null {
    return this.metabolismRuns.getById(id);
  }

  listMetabolismRuns(options: ListMetabolismRunsOptions = {}): MetabolismRun[] {
    return this.metabolismRuns.list(options);
  }

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

}
