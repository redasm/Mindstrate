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
  PROJECT_GRAPH_METADATA_KEYS,
  isProjectGraphEdge,
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
import { cosineSimilarity } from '../processing/vector-distance.js';

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

  /**
   * Run `fn` inside a single SQLite transaction.
   *
   * Used for bulk writes like the first-run project-graph index, where issuing
   * 100k+ individual auto-committed INSERTs is both slow (one fsync per row in
   * WAL mode) and non-atomic — a crash mid-write would leave a half-populated
   * graph. Wrapping the whole write makes it commit once and roll back cleanly
   * on failure. `fn` must be synchronous (better-sqlite3 transactions cannot
   * span an await).
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Raw connection handle for whole-graph batch algorithms that must run
   * set-based SQL (temp tables, joins, JSON updates) instead of pulling every
   * row into JS — e.g. project-graph binding inference, which joins 100k+ nodes
   * on a normalized symbol key. Reach for this ONLY for graph-wide passes where
   * the typed row-by-row API would defeat the point; everything else must go
   * through the repository methods so table ownership stays intact.
   */
  get rawDatabase(): Database.Database {
    return this.db;
  }

  getNodeById(id: string): ContextNode | null {
    return this.nodes.getById(id);
  }

  listNodes(options: ListContextNodesOptions = {}): ContextNode[] {
    return this.nodes.list(options);
  }

  /** Bounded substring search over node title / source_ref (assembly seeding). */
  searchNodesByText(opts: { project?: string; terms: string[]; limit: number }): ContextNode[] {
    return this.nodes.searchByTextTerms(opts);
  }

  listKnownProjects(): string[] {
    return this.nodes.listDistinctProjects();
  }

  countNodes(): number {
    return this.nodes.count();
  }

  getGraphStats(): {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
  } {
    return this.nodes.aggregateGraphStats();
  }

  getProjectBreakdown(): Array<{ project: string; entries: number; conflicts: number; lastActivity: string | null }> {
    return this.nodes.aggregateProjectBreakdown();
  }

  /**
   * Bounded project-graph subgraph for the relationship-graph UI.
   *
   * Without `focusNodeId`: a "skeleton" of the project — nodes of the given
   * kinds (default directory+file), most-salient first, capped at `limit`, plus
   * the edges among them. With `focusNodeId`: that node plus its one-hop
   * project-graph neighbors (outgoing + incoming edges, capped). This keeps the
   * payload small so a 100k+ node graph can be explored incrementally instead
   * of shipped whole.
   */
  queryProjectSubgraph(opts: {
    project: string;
    focusNodeId?: string;
    nodeKinds?: string[];
    limit?: number;
  }): { nodes: ContextNode[]; edges: ContextEdge[] } {
    const limit = Math.min(Math.max(opts.limit ?? 300, 1), 2000);
    if (opts.focusNodeId) {
      const focus = this.nodes.getById(opts.focusNodeId);
      if (!focus) return { nodes: [], edges: [] };
      const touching = [
        ...this.edges.listOutgoing(opts.focusNodeId),
        ...this.edges.listIncoming(opts.focusNodeId),
      ].filter(isProjectGraphEdge).slice(0, limit);
      const ids = Array.from(new Set([opts.focusNodeId, ...touching.flatMap((e) => [e.sourceId, e.targetId])]));
      return { nodes: this.nodes.listByIds(ids), edges: touching };
    }
    if (opts.nodeKinds && opts.nodeKinds.length > 0) {
      const nodes = this.nodes.listByProjectKinds(opts.project, opts.nodeKinds, limit);
      const edges = this.edges.listAmongNodes(nodes.map((n) => n.id));
      return { nodes, edges };
    }
    // Default skeleton: pull the structural backbone (project + directories)
    // first so file→directory/project CONTAINS edges always have both endpoints
    // present, then fill the remaining budget with files. Picking only top files
    // by salience would otherwise drop their parent nodes and leave an edgeless
    // scatter of dots.
    const structural = this.nodes.listByProjectKinds(opts.project, ['project', 'directory'], limit);
    const files = this.nodes.listByProjectKinds(
      opts.project,
      ['file'],
      Math.max(0, limit - structural.length),
    );
    const nodes = [...structural, ...files];
    const edges = this.edges.listAmongNodes(nodes.map((n) => n.id));
    return { nodes, edges };
  }

  /**
   * Bounded BFS over project-graph edges from one or more seed nodes.
   * Returns the reachable nodes (capped at `limit`) plus the project-graph
   * edges among them. Used by the MCP task-query / blast-radius tools so
   * team mode no longer pulls the entire graph over HTTP to traverse it
   * in-process.
   */
  projectGraphNeighborhood(opts: {
    seedIds: string[];
    depth: number;
    limit: number;
    edgeKinds?: string[];
  }): { nodes: ContextNode[]; edges: ContextEdge[] } {
    const limit = Math.min(Math.max(opts.limit, 1), 2000);
    const depth = Math.min(Math.max(opts.depth, 0), 6);
    const kindFilter = opts.edgeKinds && opts.edgeKinds.length > 0 ? new Set(opts.edgeKinds) : null;
    const included = new Set<string>();
    for (const id of opts.seedIds) {
      if (included.size >= limit) break;
      if (this.nodes.getById(id)) included.add(id);
    }
    const edgesById = new Map<string, ContextEdge>();
    let frontier = [...included];
    for (let d = 0; d < depth && included.size < limit; d += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        if (included.size >= limit) break;
        const touching = [...this.edges.listOutgoing(id), ...this.edges.listIncoming(id)]
          .filter(isProjectGraphEdge)
          .filter((edge) => !kindFilter
            || kindFilter.has(String(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? '')));
        for (const edge of touching) {
          edgesById.set(edge.id, edge);
          const other = edge.sourceId === id ? edge.targetId : edge.sourceId;
          if (!included.has(other)) {
            if (included.size >= limit) break;
            included.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }
    const nodes = this.nodes.listByIds([...included]);
    const edges = [...edgesById.values()].filter(
      (edge) => included.has(edge.sourceId) && included.has(edge.targetId),
    );
    return { nodes, edges };
  }

  /**
   * Bounded BFS shortest path between two nodes over project-graph edges.
   * Returns null when either endpoint is missing or no path is found within
   * `maxDepth` hops.
   */
  projectGraphShortestPath(opts: {
    fromId: string;
    toId: string;
    maxDepth: number;
  }): { nodes: ContextNode[]; edges: ContextEdge[] } | null {
    const start = this.nodes.getById(opts.fromId);
    const target = this.nodes.getById(opts.toId);
    if (!start || !target) return null;
    if (opts.fromId === opts.toId) return { nodes: [start], edges: [] };

    const maxDepth = Math.min(Math.max(opts.maxDepth, 1), 12);
    const seen = new Set<string>([opts.fromId]);
    const queue: Array<{ id: string; nodeIds: string[]; edges: ContextEdge[] }> = [
      { id: opts.fromId, nodeIds: [opts.fromId], edges: [] },
    ];
    // Guard against pathological fan-out on huge graphs.
    let visitBudget = 50000;
    while (queue.length > 0 && visitBudget > 0) {
      const current = queue.shift()!;
      if (current.edges.length >= maxDepth) continue;
      const touching = [...this.edges.listOutgoing(current.id), ...this.edges.listIncoming(current.id)]
        .filter(isProjectGraphEdge);
      for (const edge of touching) {
        visitBudget -= 1;
        const nextId = edge.sourceId === current.id ? edge.targetId : edge.sourceId;
        if (seen.has(nextId)) continue;
        const nodeIds = [...current.nodeIds, nextId];
        const pathEdges = [...current.edges, edge];
        if (nextId === opts.toId) {
          const nodes = nodeIds
            .map((id) => this.nodes.getById(id))
            .filter((node): node is ContextNode => node !== null);
          return { nodes, edges: pathEdges };
        }
        seen.add(nextId);
        queue.push({ id: nextId, nodeIds, edges: pathEdges });
      }
    }
    return null;
  }

  /**
   * Delete every context-graph row belonging to a project — nodes plus their
   * edges/embeddings/projections, and the project-scoped events, conflicts and
   * metabolism runs. One transaction so a crash can't leave a half-deleted
   * graph. Foreign keys aren't enforced on this connection, so child rows are
   * removed explicitly (via subquery, not an id list, to avoid the variable cap
   * on large graphs) before the nodes. Project match is case-insensitive, like
   * the read path.
   */
  deleteProject(project: string): { nodesDeleted: number } {
    const sub = 'SELECT id FROM context_nodes WHERE LOWER(project) = LOWER(?)';
    return this.db.transaction(() => {
      this.db.prepare(`DELETE FROM context_edges WHERE source_id IN (${sub}) OR target_id IN (${sub})`).run(project, project);
      this.db.prepare(`DELETE FROM node_embeddings WHERE node_id IN (${sub})`).run(project);
      this.db.prepare(`DELETE FROM projection_records WHERE node_id IN (${sub})`).run(project);
      const nodesDeleted = this.db.prepare('DELETE FROM context_nodes WHERE LOWER(project) = LOWER(?)').run(project).changes;
      this.db.prepare('DELETE FROM context_events WHERE LOWER(project) = LOWER(?)').run(project);
      this.db.prepare('DELETE FROM conflict_records WHERE LOWER(project) = LOWER(?)').run(project);
      this.db.prepare('DELETE FROM metabolism_runs WHERE LOWER(project) = LOWER(?)').run(project);
      return { nodesDeleted };
    })();
  }

  /**
   * Delete only the project-graph (scanner-extracted) nodes of a project,
   * leaving manually-authored knowledge, snapshots, sessions, and conflicts
   * intact. Used by "re-scan from scratch": a plain re-index upserts by stable
   * id but never removes nodes for files that no longer exist, so without this
   * those become orphans. Targets rows tagged `metadata.projectGraph = true`
   * (the marker every scanner-written node/edge carries, see graph-writer),
   * plus their edges / embeddings / projections.
   */
  deleteProjectGraphNodes(project: string): { nodesDeleted: number } {
    const sub = `
      SELECT id FROM context_nodes
      WHERE LOWER(project) = LOWER(?)
        AND json_extract(metadata, '$.${PROJECT_GRAPH_METADATA_KEYS.projectGraph}') = 1
    `;
    return this.db.transaction(() => {
      this.db.prepare(`DELETE FROM context_edges WHERE source_id IN (${sub}) OR target_id IN (${sub})`).run(project, project);
      this.db.prepare(`DELETE FROM node_embeddings WHERE node_id IN (${sub})`).run(project);
      this.db.prepare(`DELETE FROM projection_records WHERE node_id IN (${sub})`).run(project);
      const nodesDeleted = this.db.prepare(`
        DELETE FROM context_nodes
        WHERE LOWER(project) = LOWER(?)
          AND json_extract(metadata, '$.${PROJECT_GRAPH_METADATA_KEYS.projectGraph}') = 1
      `).run(project).changes;
      return { nodesDeleted };
    })();
  }

  /**
   * Count only scanner-extracted (project-graph) nodes of a project. The repo
   * scanner uses this to decide whether a first-run P4 index already happened,
   * so it must ignore manually-authored knowledge — otherwise a project that
   * has any hand-written rule would look "already indexed" and a forced
   * re-scan (cursor reset) would be skipped.
   */
  countProjectGraphNodes(project: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS c FROM context_nodes
      WHERE LOWER(project) = LOWER(?)
        AND json_extract(metadata, '$.${PROJECT_GRAPH_METADATA_KEYS.projectGraph}') = 1
    `).get(project) as { c: number };
    return row.c;
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

  /** Node ids already embedded for `model` (incremental backfill guard). */
  nodeIdsWithEmbedding(model: string): Set<string> {
    return this.nodeEmbeddings.nodeIdsWithModel(model);
  }

  /** Delete all node embeddings for a project (rebuild-vectors). */
  deleteNodeEmbeddingsForProject(project: string): number {
    return this.nodeEmbeddings.deleteForProject(project);
  }

  /**
   * Vector similarity search over stored node embeddings. Computes cosine
   * against every candidate of the same dimension as `queryEmbedding`
   * (mismatched dimensions — e.g. a legacy embedding model — are skipped,
   * not fatal), returns the top scorers above `minScore`.
   *
   * This deliberately bypasses the knowledge projector's substrate-priority
   * cap: low-priority project-graph FILE/DEPENDENCY nodes would never make
   * the projector's top-500 prefilter, yet they are exactly what semantic
   * file/code queries need to surface. Scoring here is purely by vector
   * distance over the model's own rows.
   */
  searchSimilarNodes(opts: {
    queryEmbedding: number[];
    model: string;
    project?: string;
    statuses?: string[];
    topK?: number;
    minScore?: number;
  }): Array<{ nodeId: string; score: number }> {
    const candidates = this.nodeEmbeddings.candidatesForSearch({
      model: opts.model,
      project: opts.project,
      statuses: opts.statuses,
    });
    const dim = opts.queryEmbedding.length;
    const minScore = opts.minScore ?? 0;
    const scored: Array<{ nodeId: string; score: number }> = [];
    for (const candidate of candidates) {
      if (candidate.embedding.length !== dim) continue;
      const score = cosineSimilarity(opts.queryEmbedding, candidate.embedding);
      if (score > minScore) scored.push({ nodeId: candidate.nodeId, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.topK ?? 10);
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
