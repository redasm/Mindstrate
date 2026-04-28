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
    return rows.map(rowToNode);
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
