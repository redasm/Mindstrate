import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { ContextNode } from '@mindstrate/protocol/models';
import {
  ContextDomainType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol/models';

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

export interface ListContextNodesOptions {
  project?: string;
  substrateType?: SubstrateType;
  domainType?: ContextDomainType;
  status?: ContextNodeStatus;
  sourceRef?: string;
  limit?: number;
  /**
   * Exclude scanner-extracted project-graph nodes (those tagged
   * `metadata.projectGraph = true`). Pushed into SQL so a project with a huge
   * graph (100k+ file/symbol nodes) doesn't consume the LIMIT prefetch and
   * starve the knowledge nodes the caller actually wants.
   */
  excludeProjectGraph?: boolean;
}

export class ContextNodeRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateContextNodeInput): ContextNode {
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
      JSON.stringify({
        ...(input.metadata ?? {}),
        graphVersion: typeof input.metadata?.['graphVersion'] === 'number' ? input.metadata['graphVersion'] : 1,
      }),
      now,
      now,
    );

    return this.getById(id)!;
  }

  getById(id: string): ContextNode | null {
    const row = this.db.prepare('SELECT * FROM context_nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : null;
  }

  list(options: ListContextNodesOptions = {}): ContextNode[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.project) {
      // Case-insensitive match so callers that pass `Mindstrate` or
      // `MINDSTRATE` still find rows persisted as `mindstrate`. Project
      // slugs are deliberately lower-snake-case in the detection
      // pipeline, but real-world usage routinely sees the human-cased
      // form leak in from MCP arguments / overlay imports / team-server
      // requests. Storing-time normalization was rejected because it
      // would silently rewrite existing dbs; this query-time fold
      // keeps both shapes addressable from day one.
      conditions.push('LOWER(project) = LOWER(?)');
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
    if (options.excludeProjectGraph) {
      // Tagged nodes carry metadata.projectGraph === true; exclude them in SQL
      // so they never fill the LIMIT window ahead of knowledge nodes.
      conditions.push("(json_extract(metadata, '$.projectGraph') IS NULL OR json_extract(metadata, '$.projectGraph') <> 1)");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM context_nodes ${where} ORDER BY updated_at DESC LIMIT ?`;
    params.push(options.limit ?? 100);

    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * One keyset page of embeddable nodes, ordered by primary key so the caller
   * can stream the whole set batch-by-batch without ever materializing it.
   *
   * The node-embedding backfill runs inside a 512MB team-server container over
   * graphs of 100k+ nodes; a single `list({ limit: 100000 })` load OOM-crashed
   * it (V8 JsonParser abort) and left coverage stuck at a few percent. Paging by
   * `id > afterId` keeps peak memory at O(batchSize).
   *
   * `excludeModel` pushes the incremental guard into SQL — a `NOT EXISTS`
   * anti-join skips nodes already embedded for that model, so re-running after a
   * partial scan doesn't require holding every embedded id in a JS Set.
   */
  listEmbeddablePage(opts: {
    statuses: ContextNodeStatus[];
    project?: string;
    afterId?: string;
    excludeModel?: string;
    limit: number;
  }): ContextNode[] {
    if (opts.statuses.length === 0) return [];
    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
    params.push(...opts.statuses);
    if (opts.project) {
      conditions.push('LOWER(project) = LOWER(?)');
      params.push(opts.project);
    }
    if (opts.afterId !== undefined) {
      conditions.push('id > ?');
      params.push(opts.afterId);
    }
    if (opts.excludeModel) {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM node_embeddings ne WHERE ne.node_id = context_nodes.id AND ne.model = ?)',
      );
      params.push(opts.excludeModel);
    }

    const rows = this.db.prepare(`
      SELECT * FROM context_nodes
      WHERE ${conditions.join(' AND ')}
      ORDER BY id ASC
      LIMIT ?
    `).all(...params, opts.limit) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Count embeddable nodes matching the same filter as {@link listEmbeddablePage}
   * (minus the keyset cursor). Lets the backfill report an accurate candidate /
   * progress total without materializing rows.
   */
  countEmbeddable(opts: {
    statuses: ContextNodeStatus[];
    project?: string;
    excludeModel?: string;
  }): number {
    if (opts.statuses.length === 0) return 0;
    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
    params.push(...opts.statuses);
    if (opts.project) {
      conditions.push('LOWER(project) = LOWER(?)');
      params.push(opts.project);
    }
    if (opts.excludeModel) {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM node_embeddings ne WHERE ne.node_id = context_nodes.id AND ne.model = ?)',
      );
      params.push(opts.excludeModel);
    }

    const row = this.db.prepare(`
      SELECT COUNT(*) AS c FROM context_nodes WHERE ${conditions.join(' AND ')}
    `).get(...params) as { c: number };
    return row.c;
  }

  update(id: string, input: UpdateContextNodeInput): ContextNode | null {
    const existing = this.getById(id);
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
    sets.push('metadata = ?');
    params.push(JSON.stringify(nextVersionMetadata(existing, input.metadata)));
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
    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM context_nodes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  listDistinctProjects(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT project FROM context_nodes
      WHERE project IS NOT NULL AND project != ''
      ORDER BY project ASC
    `).all() as Array<{ project: string }>;
    return rows.map((row) => row.project);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM context_nodes').get() as { c: number }).c;
  }

  /**
   * Counts grouped by domain type, status, and metadata language, computed with
   * SQL aggregates. Replaces loading every row into JS — the graph can hold
   * 100k+ project-graph nodes, and materializing them (each with a JSON-parsed
   * metadata blob) OOMs small consumers like the web-ui.
   */
  aggregateGraphStats(): {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
  } {
    const tally = (sql: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of this.db.prepare(sql).all() as Array<{ k: string | null; c: number }>) {
        if (row.k) out[row.k] = row.c;
      }
      return out;
    };
    return {
      total: this.count(),
      byType: tally('SELECT domain_type AS k, COUNT(*) AS c FROM context_nodes GROUP BY domain_type'),
      byStatus: tally('SELECT status AS k, COUNT(*) AS c FROM context_nodes GROUP BY status'),
      byLanguage: tally(
        `SELECT json_extract(metadata, '$.context.language') AS k, COUNT(*) AS c
         FROM context_nodes
         WHERE json_extract(metadata, '$.context.language') IS NOT NULL
           AND json_extract(metadata, '$.context.language') != ''
         GROUP BY k`,
      ),
    };
  }

  /**
   * Per-project rollup (entry count, conflicted count, latest activity) via a
   * single GROUP BY, so dashboards never have to pull every node.
   */
  aggregateProjectBreakdown(): Array<{ project: string; entries: number; conflicts: number; lastActivity: string | null }> {
    return this.db.prepare(`
      SELECT project,
             COUNT(*) AS entries,
             SUM(CASE WHEN status = 'conflicted' THEN 1 ELSE 0 END) AS conflicts,
             MAX(COALESCE(updated_at, created_at)) AS lastActivity
      FROM context_nodes
      WHERE project IS NOT NULL AND project != ''
      GROUP BY project
    `).all() as Array<{ project: string; entries: number; conflicts: number; lastActivity: string | null }>;
  }

  /**
   * Project-graph nodes filtered by kind (kind lives in metadata JSON, so this
   * uses json_extract). Ordered by quality so a bounded `limit` keeps the most
   * salient nodes. Used to build the subgraph "skeleton" (directory/file) for
   * the relationship-graph view without loading the whole project.
   */
  listByProjectKinds(project: string, kinds: string[], limit: number): ContextNode[] {
    if (kinds.length === 0) return [];
    const placeholders = kinds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT * FROM context_nodes
      WHERE LOWER(project) = LOWER(?)
        AND json_extract(metadata, '$.kind') IN (${placeholders})
      ORDER BY quality_score DESC, updated_at DESC
      LIMIT ?
    `).all(project, ...kinds, limit) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Bounded, salience-ordered fetch of a project's nodes in a domain. Unlike
   * `list` (which orders by recency and is used with a 100k limit for full
   * loads), this orders by quality_score so a small limit keeps the most
   * salient nodes — used by LLM-feeding paths (system-page planner, enrichment,
   * summarizer) that only consume a salience-ranked top-N. Loading the whole
   * architecture layer (100k+ nodes, each with a JSON metadata blob) OOMs on
   * large graphs.
   */
  listByProjectDomainRanked(project: string, domainType: ContextDomainType, limit: number): ContextNode[] {
    const rows = this.db.prepare(`
      SELECT * FROM context_nodes
      WHERE LOWER(project) = LOWER(?)
        AND domain_type = ?
      ORDER BY quality_score DESC, updated_at DESC
      LIMIT ?
    `).all(project, domainType, limit) as NodeRow[];
    return rows.map(rowToNode);
  }

  /** Fetch nodes by an explicit id list (subgraph neighbor expansion). */
  listByIds(ids: string[]): ContextNode[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM context_nodes WHERE id IN (${placeholders})`,
    ).all(...ids) as NodeRow[];
    return rows.map(rowToNode);
  }

  /**
   * Bounded substring search over title / source_ref for any of `terms`
   * (OR-combined, case-insensitive). Used by context assembly to find
   * project-graph seed nodes by file path / task keyword WITHOUT loading
   * the whole architecture layer into memory. `_` and `%` in terms are
   * escaped so path fragments don't act as LIKE wildcards.
   */
  searchByTextTerms(opts: { project?: string; terms: string[]; limit: number }): ContextNode[] {
    const terms = Array.from(new Set(
      opts.terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2),
    )).slice(0, 24);
    if (terms.length === 0) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.project) {
      conditions.push('LOWER(project) = LOWER(?)');
      params.push(opts.project);
    }
    const likeClauses: string[] = [];
    for (const term of terms) {
      const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      likeClauses.push("(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(source_ref) LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`);
    }
    conditions.push(`(${likeClauses.join(' OR ')})`);

    const sql = `SELECT * FROM context_nodes WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`;
    params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params) as NodeRow[];
    return rows.map(rowToNode);
  }

  recordAccess(id: string, accessedAt = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE context_nodes
      SET access_count = access_count + 1,
          last_accessed_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(accessedAt, accessedAt, id);
  }
}

function rowToNode(row: NodeRow): ContextNode {
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

function nextVersionMetadata(
  existing: ContextNode,
  updates?: Record<string, unknown>,
): Record<string, unknown> {
  const current = existing.metadata ?? {};
  const currentVersion = typeof current['graphVersion'] === 'number' ? current['graphVersion'] : 1;
  return {
    ...current,
    ...(updates ?? {}),
    graphVersion: currentVersion + 1,
    previousGraphHash: hashGraphNode(existing),
  };
}

function hashGraphNode(node: ContextNode): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: node.id,
      substrateType: node.substrateType,
      domainType: node.domainType,
      title: node.title,
      content: node.content,
      tags: node.tags,
      project: node.project,
      compressionLevel: node.compressionLevel,
      confidence: node.confidence,
      qualityScore: node.qualityScore,
      status: node.status,
      sourceRef: node.sourceRef,
      metadata: node.metadata,
    }))
    .digest('hex');
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
