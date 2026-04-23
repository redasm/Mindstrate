/**
 * Mindstrate - Automatic Feedback Loop
 *
 * 自动反馈闭环系统
 *
 * 核心思想：
 * 1. 当 AI 检索到知识时，记录一个 "pending" 反馈事件
 * 2. 当 AI 使用/拒绝/忽略该知识时，记录反馈信号
 * 3. 根据反馈信号自动调整知识质量分
 *
 * 这实现了从"被动人工投票"到"主动自动反馈"的升级。
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { FeedbackEvent } from '@mindstrate/protocol';
import { MetadataStore } from '../storage/metadata-store.js';

export class FeedbackLoop {
  private db: Database.Database;
  private metadataStore: MetadataStore;

  constructor(db: Database.Database, metadataStore: MetadataStore) {
    this.db = db;
    this.metadataStore = metadataStore;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_events (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        query TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        signal TEXT NOT NULL DEFAULT 'pending',
        responded_at TEXT,
        context TEXT,
        session_id TEXT,

        FOREIGN KEY (knowledge_id) REFERENCES knowledge_units(id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_knowledge
        ON feedback_events(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_signal
        ON feedback_events(signal);
      CREATE INDEX IF NOT EXISTS idx_feedback_session
        ON feedback_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_retrieved
        ON feedback_events(retrieved_at);
    `);
  }

  /**
   * 记录一次检索事件（AI 检索到了某条知识）
   * 返回 retrievalId 用于后续跟踪反馈
   */
  trackRetrieval(
    knowledgeId: string,
    query: string,
    sessionId?: string,
  ): string {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO feedback_events (id, knowledge_id, query, retrieved_at, signal, session_id)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, knowledgeId, query, now, sessionId ?? null);

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
      'SELECT knowledge_id FROM feedback_events WHERE id = ?'
    ).get(retrievalId) as { knowledge_id: string } | undefined;

    if (!row) return;

    this.db.prepare(`
      UPDATE feedback_events
      SET signal = ?, responded_at = ?, context = ?
      WHERE id = ?
    `).run(signal, now, context ?? null, retrievalId);

    // 根据反馈信号自动调整知识质量
    this.applyFeedbackToScore(row.knowledge_id, signal);
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
   * 根据反馈信号调整知识质量分
   *
   * 不只是记录成功失败，而是理解"为什么"来做针对性改进。
   */
  private applyFeedbackToScore(
    knowledgeId: string,
    signal: FeedbackEvent['signal'],
  ): void {
    const knowledge = this.metadataStore.getById(knowledgeId);
    if (!knowledge) return;

    switch (signal) {
      case 'adopted':
        // 被采纳 → 记录使用，相当于隐式 upvote
        this.metadataStore.recordUsage(knowledgeId);
        break;
      case 'rejected':
        // 被拒绝 → 累计拒绝次数作为负面信号
        // 但不直接 downvote（可能是场景不匹配，不一定是知识质量差）
        this.incrementRejectCount(knowledgeId);
        break;
      case 'ignored':
        // 被忽略 → 轻微负面信号（可能不够相关）
        // 不做直接操作，但在 scorer 中会考虑
        break;
      case 'partial':
        // 部分采纳 → 正面信号但不如完全采纳
        this.metadataStore.recordUsage(knowledgeId);
        break;
    }
  }

  /**
   * 增加拒绝计数 — 通过维护任务统一处理自动投票
   *
   * 修复：不再在每次反馈事件中触发自动投票，
   * 而是只在 runMaintenance 时统一评估，避免雪崩效应。
   */
  private incrementRejectCount(_knowledgeId: string): void {
    // 不在单次反馈中触发投票，由 scorer.runMaintenance() 统一处理
    // 反馈数据已记录在 feedback_events 表中，scorer 会通过
    // feedbackLoop.getFeedbackStats() 读取并纳入评分
  }

  /**
   * 获取某条知识的反馈统计
   */
  getFeedbackStats(knowledgeId: string): {
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
      WHERE knowledge_id = ? AND signal != 'pending'
      GROUP BY signal
    `).all(knowledgeId) as { signal: string; cnt: number }[];

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
      knowledgeId: r.knowledge_id,
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
    lowAdoptionKnowledge: string[];
  } {
    const totalEvents = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM feedback_events'
    ).get() as any).cnt;

    const last30DaysThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const last30Days = (this.db.prepare(
      'SELECT COUNT(*) as cnt FROM feedback_events WHERE retrieved_at > ?'
    ).get(last30DaysThreshold) as any).cnt;

    // 找出采纳率低的知识（至少被检索 5 次，采纳率 < 30%）
    const lowAdoption = this.db.prepare(`
      SELECT knowledge_id,
        SUM(CASE WHEN signal = 'adopted' THEN 1 ELSE 0 END) as adopted,
        SUM(CASE WHEN signal = 'partial' THEN 1 ELSE 0 END) as partial_cnt,
        COUNT(*) as total
      FROM feedback_events
      WHERE signal != 'pending'
      GROUP BY knowledge_id
      HAVING total >= 5
        AND (CAST(adopted AS REAL) + CAST(partial_cnt AS REAL) * 0.5) / total < 0.3
    `).all() as { knowledge_id: string }[];

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
      lowAdoptionKnowledge: lowAdoption.map(r => r.knowledge_id),
    };
  }
}
