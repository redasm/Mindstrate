/**
 * Mindstrate - Session Store
 *
 * 会话记忆的 SQLite 存储层。
 * 管理会话生命周期：创建 → 记录观察 → 压缩 → 结束 → 恢复。
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session,
  SessionStatus,
  SessionContext,
  CreateSessionInput,
  SaveObservationInput,
  CompressSessionInput,
} from '@mindstrate/protocol';

export class SessionStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        summary TEXT,
        decisions TEXT,          -- JSON array
        open_tasks TEXT,         -- JSON array
        problems_solved TEXT,    -- JSON array
        files_modified TEXT,     -- JSON array
        tech_context TEXT,
        observations TEXT        -- JSON array of SessionObservation
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
    `);
  }

  /** 创建新会话 */
  create(input: CreateSessionInput): Session {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, project, status, started_at, tech_context, observations)
      VALUES (?, ?, 'active', ?, ?, '[]')
    `).run(id, input.project ?? '', now, input.techContext ?? null);

    return this.getById(id)!;
  }

  /** 获取会话 */
  getById(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  /** 获取当前活跃会话（某项目） */
  getActiveSession(project: string = ''): Session | null {
    const row = this.db.prepare(
      "SELECT * FROM sessions WHERE project = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1"
    ).get(project) as any;
    if (!row) return null;
    return this.rowToSession(row);
  }

  /** 添加观察记录（使用 SQLite JSON 函数原子追加，避免读写竞态） */
  addObservation(input: SaveObservationInput): void {
    const observation = JSON.stringify({
      timestamp: new Date().toISOString(),
      type: input.type,
      content: input.content,
      metadata: input.metadata,
    });

    this.db.prepare(`
      UPDATE sessions
      SET observations = json_insert(
        COALESCE(observations, '[]'),
        '$[#]',
        json(?)
      )
      WHERE id = ?
    `).run(observation, input.sessionId);
  }

  /** 压缩会话（写入 AI 生成的摘要） */
  compress(input: CompressSessionInput): void {
    this.db.prepare(`
      UPDATE sessions SET
        summary = ?,
        decisions = ?,
        open_tasks = ?,
        problems_solved = ?,
        files_modified = ?
      WHERE id = ?
    `).run(
      input.summary,
      input.decisions ? JSON.stringify(input.decisions) : null,
      input.openTasks ? JSON.stringify(input.openTasks) : null,
      input.problemsSolved ? JSON.stringify(input.problemsSolved) : null,
      input.filesModified ? JSON.stringify(input.filesModified) : null,
      input.sessionId,
    );
  }

  /** 结束会话 */
  endSession(id: string, status: 'completed' | 'abandoned' = 'completed'): void {
    this.db.prepare(
      'UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?'
    ).run(status, new Date().toISOString(), id);
  }

  /** 获取项目的最近 N 个已完成会话 */
  getRecentSessions(project: string = '', limit: number = 5): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE project = ? AND status != 'active'
      ORDER BY ended_at DESC
      LIMIT ?
    `).all(project, limit) as any[];
    return rows.map(r => this.rowToSession(r));
  }

  /**
   * 恢复会话上下文——新会话开始时调用
   *
   * 返回上一次会话的摘要 + 最近的时间线 + 项目累积上下文
   */
  restoreContext(project: string = ''): SessionContext {
    const recent = this.getRecentSessions(project, 5);

    if (recent.length === 0) {
      return {};
    }

    const last = recent[0];
    const context: SessionContext = {};

    // 上一次会话的详细信息
    if (last.summary) {
      context.lastSession = {
        summary: last.summary,
        decisions: last.decisions ?? [],
        openTasks: last.openTasks ?? [],
        problemsSolved: last.problemsSolved ?? [],
        filesModified: last.filesModified ?? [],
        endedAt: last.endedAt ?? last.startedAt,
      };
    }

    // 最近几次会话的时间线
    context.recentTimeline = recent
      .filter(s => s.summary)
      .map(s => ({
        id: s.id,
        summary: s.summary!,
        endedAt: s.endedAt ?? s.startedAt,
      }));

    // 从所有近期会话中聚合未完成的任务
    const allOpenTasks = recent
      .flatMap(s => s.openTasks ?? [])
      .filter((task, idx, arr) => arr.indexOf(task) === idx) // 去重
      .slice(0, 10);

    if (allOpenTasks.length > 0) {
      context.projectContext = `Pending tasks from recent sessions:\n${allOpenTasks.map(t => `- ${t}`).join('\n')}`;
    }

    return context;
  }

  /** 格式化上下文为可注入的文本 */
  formatContextForInjection(ctx: SessionContext): string {
    if (!ctx.lastSession && !ctx.recentTimeline?.length && !ctx.graphSnapshots?.length) {
      return '';
    }

    const parts: string[] = [];
    parts.push('[SESSION MEMORY - Previous Context]');

    if (ctx.lastSession) {
      parts.push(`\n## Last Session Summary`);
      parts.push(ctx.lastSession.summary);

      if (ctx.lastSession.openTasks.length > 0) {
        parts.push(`\n## Open Tasks (unfinished from last session)`);
        ctx.lastSession.openTasks.forEach(t => parts.push(`- ${t}`));
      }

      if (ctx.lastSession.decisions.length > 0) {
        parts.push(`\n## Key Decisions`);
        ctx.lastSession.decisions.forEach(d => parts.push(`- ${d}`));
      }

      if (ctx.lastSession.filesModified.length > 0) {
        parts.push(`\n## Recently Modified Files`);
        ctx.lastSession.filesModified.forEach(f => parts.push(`- ${f}`));
      }
    }

    if (ctx.recentTimeline && ctx.recentTimeline.length > 1) {
      parts.push(`\n## Session History (recent ${ctx.recentTimeline.length} sessions)`);
      ctx.recentTimeline.forEach(s => {
        parts.push(`- [${s.endedAt}] ${s.summary}`);
      });
    }

    if (ctx.projectContext) {
      parts.push(`\n## Project Context`);
      parts.push(ctx.projectContext);
    }

    if (ctx.graphSnapshots?.length) {
      parts.push(`\n## ECS Session Snapshots`);
      ctx.graphSnapshots.forEach((snapshot) => {
        const endedAt = snapshot.endedAt ? ` [${snapshot.endedAt}]` : '';
        parts.push(`- ${snapshot.title}${endedAt}: ${snapshot.summary}`);
      });
    }

    return parts.join('\n');
  }

  // ========================================
  // Private
  // ========================================

  private rowToSession(row: any): Session {
    return {
      id: row.id,
      project: row.project,
      status: row.status as SessionStatus,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      summary: row.summary ?? undefined,
      decisions: row.decisions ? JSON.parse(row.decisions) : undefined,
      openTasks: row.open_tasks ? JSON.parse(row.open_tasks) : undefined,
      problemsSolved: row.problems_solved ? JSON.parse(row.problems_solved) : undefined,
      filesModified: row.files_modified ? JSON.parse(row.files_modified) : undefined,
      techContext: row.tech_context ?? undefined,
      observations: row.observations ? JSON.parse(row.observations) : undefined,
    };
  }
}
