/**
 * Mindstrate - ECS Context Graph Store
 *
 * Graph-native storage for ECS nodes, edges, events and projections.
 */

import Database from 'better-sqlite3';
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
  type UpdateContextEdgeInput,
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
import {
  initializeContextGraphSchema,
  openContextGraphDatabase,
  type ContextGraphDbHandle,
} from './context-graph-database.js';
import { GraphQuery } from './graph-query.js';

export type {
  CreateContextEdgeInput,
  UpdateContextEdgeInput,
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

  constructor(dbOrPath: ContextGraphDbHandle) {
    const connection = openContextGraphDatabase(dbOrPath);
    this.db = connection.db;
    this.ownsDb = connection.ownsDb;

    initializeContextGraphSchema(this.db);
    this.nodes = new ContextNodeRepository(this.db);
    this.edges = new ContextEdgeRepository(this.db);
    this.events = new ContextEventRepository(this.db);
    this.nodeEmbeddings = new NodeEmbeddingRepository(this.db);
    this.conflictRecords = new ConflictRecordRepository(this.db);
    this.projectionRecords = new ProjectionRecordRepository(this.db);
    this.metabolismRuns = new MetabolismRunRepository(this.db);
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

  updateEdge(id: string, input: UpdateContextEdgeInput): ContextEdge | null {
    return this.edges.update(id, input);
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
