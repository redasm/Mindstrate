/**
 * Mindstrate - Automatic Feedback Loop
 *
 * 自动反馈闭环系统
 *
 * 核心思想：
 * 1. 当 AI 检索到图节点时，记录一个 "pending" 反馈事件
 * 2. 当 AI 使用/拒绝/忽略该节点时，记录反馈信号
 * 3. 根据反馈信号自动调整图节点反馈计数
 *
 * 这实现了从"被动人工投票"到"主动自动反馈"的升级。
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { FeedbackEvent } from '@mindstrate/protocol';

export class FeedbackLoop {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_events (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        query TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        signal TEXT NOT NULL DEFAULT 'pending',
        responded_at TEXT,
        context TEXT,
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_knowledge
        ON feedback_events(node_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_signal
        ON feedback_events(signal);
      CREATE INDEX IF NOT EXISTS idx_feedback_session
        ON feedback_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_retrieved
        ON feedback_events(retrieved_at);
    `);
  }

  /**
   * 记录一次检索事件（AI 检索到了某个图节点）
   * 返回 retrievalId 用于后续跟踪反馈
   */
  trackRetrieval(
    nodeId: string,
    query: string,
    sessionId?: string,
  ): string {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO feedback_events (id, node_id, query, retrieved_at, signal, session_id)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, nodeId, query, now, sessionId ?? null);

    return id;
  }

  /**
   * 记录反馈信号
   *
   * - adopted:  知识被采纳使用
   * - rejected: 知识被明确拒绝
   * - ignored:  知识被忽略（未使用也未拒绝）
   * - partial:  知识被部分采纳
   */
  recordFeedback(
    retrievalId: string,
    signal: FeedbackEvent['signal'],
    context?: string,
  ): void {
    const now = new Date().toISOString();

    const row = this.db.prepare(
      'SELECT node_id FROM feedback_events WHERE id = ?'
    ).get(retrievalId) as { node_id: string } | undefined;

    if (!row) return;

    this.db.prepare(`
      UPDATE feedback_events
      SET signal = ?, responded_at = ?, context = ?
      WHERE id = ?
    `).run(signal, now, context ?? null, retrievalId);

    this.applyFeedbackToNode(row.node_id, signal);
  }

  /**
   * 批量标记超时的 pending 事件为 ignored
   * 通常在会话结束时调用
   */
  resolveTimeouts(sessionId: string): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE feedback_events
      SET signal = 'ignored', responded_at = ?
      WHERE session_id = ? AND signal = 'pending'
    `).run(now, sessionId);

    return result.changes;
  }

  /**
   * 根据反馈信号调整图节点反馈计数。
   */
  private applyFeedbackToNode(
    nodeId: string,
    signal: FeedbackEvent['signal'],
  ): void {
    switch (signal) {
      case 'adopted':
        this.incrementNodeFeedback(nodeId, 'positive_feedback');
        break;
      case 'rejected':
        this.incrementNodeFeedback(nodeId, 'negative_feedback');
        break;
      case 'ignored':
        break;
      case 'partial':
        this.incrementNodeFeedback(nodeId, 'positive_feedback');
        break;
    }
  }

  private incrementNodeFeedback(
    nodeId: string,
    column: 'positive_feedback' | 'negative_feedback',
  ): void {
    this.db.prepare(`
      UPDATE context_nodes
      SET ${column} = ${column} + 1,
          updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), nodeId);
  }

  /**
   * 获取某个图节点的反馈统计
   */
  getFeedbackStats(nodeId: string): {
    total: number;
    adopted: number;
    rejected: number;
    ignored: number;
    partial: number;
    adoptionRate: number;
  } {
    const rows = this.db.prepare(`
      SELECT signal, COUNT(*) as cnt
      FROM feedback_events
      WHERE node_id = ? AND signal != 'pending'
      GROUP BY signal
    `).all(nodeId) as { signal: string; cnt: number }[];

    const adopted = rows.find(r => r.signal === 'adopted')?.cnt ?? 0;
    const rejected = rows.find(r => r.signal === 'rejected')?.cnt ?? 0;
    const ignored = rows.find(r => r.signal === 'ignored')?.cnt ?? 0;
    const partial = rows.find(r => r.signal === 'partial')?.cnt ?? 0;
    const total = adopted + rejected + ignored + partial;

    return {
      total,
      adopted,
      rejected,
      ignored,
      partial,
      adoptionRate: total > 0 ? (adopted + partial * 0.5) / total : 0,
    };
  }

  /**
   * 获取某会话中待处理的反馈事件
   */
  getPendingFeedbacks(sessionId: string): FeedbackEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM feedback_events
      WHERE session_id = ? AND signal = 'pending'
    `).all(sessionId) as any[];

    return rows.map(r => ({
      id: r.id,
      nodeId: r.node_id,
      query: r.query,
      retrievedAt: r.retrieved_at,
      signal: r.signal,
      respondedAt: r.responded_at ?? undefined,
      context: r.context ?? undefined,
      sessionId: r.session_id ?? undefined,
    }));
  }

  /**
   * 获取全局反馈统计（用于维护报告）
   */
  getGlobalStats(): {
    totalEvents: number;
    last30Days: number;
    avgAdoptionRate: number;
    lowAdoptionNodes: string[];
  } {
    const totalEvents = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM feedback_events'
    ).get() as any).cnt;

    const last30DaysThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const last30Days = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM feedback_events WHERE retrieved_at > ?'
    ).get(last30DaysThreshold) as any).cnt;

    // 找出采纳率低的节点（至少被检索 5 次，采纳率 < 30%）
    const lowAdoption = this.db.prepare(`
      SELECT node_id,
        SUM(CASE WHEN signal = 'adopted' THEN 1 ELSE 0 END) as adopted,
        SUM(CASE WHEN signal = 'partial' THEN 1 ELSE 0 END) as partial_cnt,
        COUNT(*) as total
      FROM feedback_events
      WHERE signal != 'pending'
      GROUP BY node_id
      HAVING total >= 5
        AND (CAST(adopted AS REAL) + CAST(partial_cnt AS REAL) * 0.5) / total < 0.3
    `).all() as { node_id: string }[];

    // 全局平均采纳率
    const globalAdoption = this.db.prepare(`
      SELECT
        SUM(CASE WHEN signal = 'adopted' THEN 1.0 WHEN signal = 'partial' THEN 0.5 ELSE 0 END) as positive,
        COUNT(*) as total
      FROM feedback_events
      WHERE signal != 'pending'
    `).get() as { positive: number; total: number };

    return {
      totalEvents,
      last30Days,
      avgAdoptionRate: globalAdoption.total > 0
        ? globalAdoption.positive / globalAdoption.total
        : 0,
      lowAdoptionNodes: lowAdoption.map(r => r.node_id),
    };
  }
}
