/**
 * Mindstrate - SQLite Metadata Store
 *
 * 使用 better-sqlite3 存储知识单元的完整结构化数据。
 * 支持按字段查询、统计、更新等操作。
 */

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type KnowledgeUnit,
  type CreateKnowledgeInput,
  type UpdateKnowledgeInput,
  type RetrievalFilter,
  KnowledgeStatus,
  CaptureSource,
} from '@mindstrate/protocol';
import { v4 as uuidv4 } from 'uuid';

export class MetadataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    // 确保目录存在
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  /** 初始化数据库表 */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_units (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,

        -- 内容
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        problem TEXT,
        solution TEXT NOT NULL,
        code_snippets TEXT,  -- JSON
        tags TEXT,           -- JSON array

        -- 上下文
        ctx_project TEXT,
        ctx_language TEXT,
        ctx_framework TEXT,
        ctx_file_paths TEXT,   -- JSON array
        ctx_dependencies TEXT, -- JSON array

        -- 元数据
        author TEXT NOT NULL DEFAULT 'anonymous',
        source TEXT NOT NULL DEFAULT 'cli',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        commit_hash TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,

        -- 质量
        score REAL NOT NULL DEFAULT 50,
        upvotes INTEGER NOT NULL DEFAULT 0,
        downvotes INTEGER NOT NULL DEFAULT 0,
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        verified INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'probation',

        -- 可执行指导
        actionable TEXT,     -- JSON (ActionableGuide)

        -- 进化历史
        evolution TEXT        -- JSON array (EvolutionRecord[])
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_units(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_status ON knowledge_units(status);
      CREATE INDEX IF NOT EXISTS idx_knowledge_language ON knowledge_units(ctx_language);
      CREATE INDEX IF NOT EXISTS idx_knowledge_framework ON knowledge_units(ctx_framework);
      CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_units(ctx_project);
      CREATE INDEX IF NOT EXISTS idx_knowledge_score ON knowledge_units(score);
      CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_units(created_at);
    `);

    // 迁移：为已有数据库添加新列（如果不存在）
    this.migrateAddColumns();
  }

  /** 安全添加新列（兼容已有数据库） */
  private migrateAddColumns(): void {
    const columns = this.db.pragma('table_info(knowledge_units)') as { name: string }[];
    const existingCols = new Set(columns.map(c => c.name));

    if (!existingCols.has('actionable')) {
      this.db.exec('ALTER TABLE knowledge_units ADD COLUMN actionable TEXT');
    }
    if (!existingCols.has('evolution')) {
      this.db.exec('ALTER TABLE knowledge_units ADD COLUMN evolution TEXT');
    }
  }

  /** 创建知识单元 */
  create(input: CreateKnowledgeInput, options?: { id?: string }): KnowledgeUnit {
    const now = new Date().toISOString();
    const id = options?.id ?? uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO knowledge_units (
        id, version, type, title, problem, solution, code_snippets, tags,
        ctx_project, ctx_language, ctx_framework, ctx_file_paths, ctx_dependencies,
        author, source, created_at, updated_at, commit_hash, confidence,
        score, status, actionable, evolution
      ) VALUES (
        ?, 1, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        50, 'probation', ?, ?
      )
    `);

    const initialEvolution = JSON.stringify([{
      type: 'created',
      timestamp: now,
      description: `Created via ${input.source ?? 'cli'}`,
    }]);

    stmt.run(
      id,
      input.type,
      input.title,
      input.problem ?? null,
      input.solution,
      input.codeSnippets ? JSON.stringify(input.codeSnippets) : null,
      JSON.stringify(input.tags ?? []),
      input.context?.project ?? null,
      input.context?.language ?? null,
      input.context?.framework ?? null,
      input.context?.filePaths ? JSON.stringify(input.context.filePaths) : null,
      input.context?.dependencies ? JSON.stringify(input.context.dependencies) : null,
      input.author ?? 'anonymous',
      input.source ?? CaptureSource.CLI,
      now,
      now,
      input.commitHash ?? null,
      input.confidence ?? 0.5,
      input.actionable ? JSON.stringify(input.actionable) : null,
      initialEvolution,
    );

    return this.getById(id)!;
  }

  /** 根据 ID 获取知识单元 */
  getById(id: string): KnowledgeUnit | null {
    const row = this.db.prepare('SELECT * FROM knowledge_units WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToKnowledge(row);
  }

  /** 根据 ID 列表批量获取 */
  getByIds(ids: string[]): KnowledgeUnit[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT * FROM knowledge_units WHERE id IN (${placeholders})`
    ).all(...ids) as any[];
    return rows.map(r => this.rowToKnowledge(r));
  }

  /** 按条件过滤查询 */
  query(filter: RetrievalFilter, limit: number = 50): KnowledgeUnit[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.language) {
      conditions.push('ctx_language = ?');
      params.push(filter.language);
    }
    if (filter.framework) {
      conditions.push('ctx_framework = ?');
      params.push(filter.framework);
    }
    if (filter.project) {
      conditions.push('ctx_project = ?');
      params.push(filter.project);
    }
    if (filter.types && filter.types.length > 0) {
      const ph = filter.types.map(() => '?').join(',');
      conditions.push(`type IN (${ph})`);
      params.push(...filter.types);
    }
    if (filter.minScore !== undefined) {
      conditions.push('score >= ?');
      params.push(filter.minScore);
    }
    if (filter.tags && filter.tags.length > 0) {
      // tags 以 JSON 数组存储，使用 LIKE 匹配每个标签
      const tagConditions = filter.tags.map(() => "tags LIKE ? ESCAPE '\\'");
      conditions.push(`(${tagConditions.join(' OR ')})`);
      for (const tag of filter.tags) {
        const escaped = tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        params.push(`%"${escaped}"%`);
      }
    }
    if (filter.status && filter.status.length > 0) {
      const ph = filter.status.map(() => '?').join(',');
      conditions.push(`status IN (${ph})`);
      params.push(...filter.status);
    } else {
      // 默认排除已废弃
      conditions.push("status != 'deprecated'");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM knowledge_units ${where} ORDER BY score DESC, updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToKnowledge(r));
  }

  /** 更新知识单元 */
  update(id: string, input: UpdateKnowledgeInput): KnowledgeUnit | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?', 'version = version + 1'];
    const params: any[] = [now];

    if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title); }
    if (input.problem !== undefined) { sets.push('problem = ?'); params.push(input.problem); }
    if (input.solution !== undefined) { sets.push('solution = ?'); params.push(input.solution); }
    if (input.codeSnippets !== undefined) { sets.push('code_snippets = ?'); params.push(JSON.stringify(input.codeSnippets)); }
    if (input.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(input.tags)); }
    if (input.confidence !== undefined) { sets.push('confidence = ?'); params.push(input.confidence); }
    if (input.actionable !== undefined) { sets.push('actionable = ?'); params.push(JSON.stringify(input.actionable)); }
    if (input.context) {
      if (input.context.project !== undefined) { sets.push('ctx_project = ?'); params.push(input.context.project); }
      if (input.context.language !== undefined) { sets.push('ctx_language = ?'); params.push(input.context.language); }
      if (input.context.framework !== undefined) { sets.push('ctx_framework = ?'); params.push(input.context.framework); }
      if (input.context.filePaths !== undefined) { sets.push('ctx_file_paths = ?'); params.push(JSON.stringify(input.context.filePaths)); }
      if (input.context.dependencies !== undefined) { sets.push('ctx_dependencies = ?'); params.push(JSON.stringify(input.context.dependencies)); }
    }

    params.push(id);
    this.db.prepare(`UPDATE knowledge_units SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    return this.getById(id);
  }

  /** 记录一次使用 */
  recordUsage(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE knowledge_units
      SET use_count = use_count + 1, last_used_at = ?
      WHERE id = ?
    `).run(now, id);
  }

  /** 投票 */
  vote(id: string, direction: 'up' | 'down'): void {
    const col = direction === 'up' ? 'upvotes' : 'downvotes';
    this.db.prepare(`UPDATE knowledge_units SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
  }

  /** 更新质量分 */
  updateScore(id: string, score: number): void {
    this.db.prepare('UPDATE knowledge_units SET score = ? WHERE id = ?').run(score, id);
  }

  /** 更新状态 */
  updateStatus(id: string, status: KnowledgeStatus): void {
    this.db.prepare('UPDATE knowledge_units SET status = ? WHERE id = ?').run(status, id);
  }

  /** 删除 */
  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM knowledge_units WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** 获取统计信息 */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
  } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM knowledge_units').get() as any).count;

    const byType: Record<string, number> = {};
    const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM knowledge_units GROUP BY type').all() as any[];
    for (const r of typeRows) byType[r.type] = r.count;

    const byStatus: Record<string, number> = {};
    const statusRows = this.db.prepare('SELECT status, COUNT(*) as count FROM knowledge_units GROUP BY status').all() as any[];
    for (const r of statusRows) byStatus[r.status] = r.count;

    const byLanguage: Record<string, number> = {};
    const langRows = this.db.prepare('SELECT ctx_language, COUNT(*) as count FROM knowledge_units WHERE ctx_language IS NOT NULL GROUP BY ctx_language').all() as any[];
    for (const r of langRows) byLanguage[r.ctx_language] = r.count;

    return { total, byType, byStatus, byLanguage };
  }

  /** 获取所有知识（用于维护任务），可选 limit */
  getAll(limit?: number): KnowledgeUnit[] {
    const sql = limit
      ? 'SELECT * FROM knowledge_units ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM knowledge_units ORDER BY created_at DESC';
    const rows = limit
      ? (this.db.prepare(sql).all(limit) as any[])
      : (this.db.prepare(sql).all() as any[]);
    return rows.map(r => this.rowToKnowledge(r));
  }

  /** 更新进化历史（供 Evolution Engine 使用） */
  updateEvolution(id: string, evolution: import('@mindstrate/protocol').EvolutionRecord[]): void {
    this.db.prepare(
      'UPDATE knowledge_units SET evolution = ? WHERE id = ?'
    ).run(JSON.stringify(evolution), id);
  }

  /** 关闭数据库连接 */
  close(): void {
    this.db.close();
  }

  /** 根据 ID 前缀查找知识（高效 SQL LIKE 查询） */
  findByIdPrefix(prefix: string): KnowledgeUnit | null {
    const row = this.db.prepare(
      "SELECT * FROM knowledge_units WHERE id LIKE ? ESCAPE '\\' LIMIT 1"
    ).get(`${prefix}%`) as any;
    if (!row) return null;
    return this.rowToKnowledge(row);
  }

  /** 获取底层数据库实例（供 SessionStore 共享） */
  getDb(): Database.Database {
    return this.db;
  }

  // ========================================
  // Private helpers
  // ========================================

  private rowToKnowledge(row: any): KnowledgeUnit {
    return {
      id: row.id,
      version: row.version,
      type: row.type,
      title: row.title,
      problem: row.problem ?? undefined,
      solution: row.solution,
      codeSnippets: row.code_snippets ? JSON.parse(row.code_snippets) : undefined,
      tags: row.tags ? JSON.parse(row.tags) : [],
      context: {
        project: row.ctx_project ?? undefined,
        language: row.ctx_language ?? undefined,
        framework: row.ctx_framework ?? undefined,
        filePaths: row.ctx_file_paths ? JSON.parse(row.ctx_file_paths) : undefined,
        dependencies: row.ctx_dependencies ? JSON.parse(row.ctx_dependencies) : undefined,
      },
      metadata: {
        author: row.author,
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at ?? undefined,
        commitHash: row.commit_hash ?? undefined,
        confidence: row.confidence,
      },
      quality: {
        score: row.score,
        upvotes: row.upvotes,
        downvotes: row.downvotes,
        useCount: row.use_count,
        lastUsedAt: row.last_used_at ?? undefined,
        verified: row.verified === 1,
        status: row.status,
      },
      actionable: row.actionable ? JSON.parse(row.actionable) : undefined,
      evolution: row.evolution ? JSON.parse(row.evolution) : undefined,
    };
  }
}
