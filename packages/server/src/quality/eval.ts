/**
 * Mindstrate - Retrieval Quality Evaluation
 *
 * 检索质量评估系统
 *
 * 核心功能：
 * 1. 构建评估数据集（给定问题 → 应该检索到哪些知识）
 * 2. 定期运行评估，跟踪检索精度变化趋势
 * 3. 当精度下降时自动触发知识库维护
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Retriever } from '../retrieval/retriever.js';

/** 评估用例 */
export interface EvalCase {
  id: string;
  /** 查询文本 */
  query: string;
  /** 期望返回的知识 ID 列表 */
  expectedIds: string[];
  /** 查询上下文（可选） */
  language?: string;
  framework?: string;
  /** 创建时间 */
  createdAt: string;
}

/** 单次评估运行结果 */
export interface EvalRunResult {
  /** 运行 ID */
  runId: string;
  /** 运行时间 */
  timestamp: string;
  /** 评估用例数 */
  totalCases: number;
  /** 精确率 (检索到的期望知识 / 检索到的总数) */
  precision: number;
  /** 召回率 (检索到的期望知识 / 期望总数) */
  recall: number;
  /** F1 分数 */
  f1: number;
  /** 平均排名（期望知识在结果中的平均位置） */
  meanReciprocalRank: number;
  /** 每条用例的详细结果 */
  details: EvalCaseResult[];
}

/** 单条评估用例的结果 */
export interface EvalCaseResult {
  caseId: string;
  query: string;
  expectedIds: string[];
  retrievedIds: string[];
  hits: string[];
  misses: string[];
  precision: number;
  recall: number;
}

export class RetrievalEvaluator {
  private db: Database.Database;
  private retriever: Retriever;

  constructor(db: Database.Database, retriever: Retriever) {
    this.db = db;
    this.retriever = retriever;
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_cases (
        id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        expected_ids TEXT NOT NULL,  -- JSON array
        language TEXT,
        framework TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        total_cases INTEGER NOT NULL,
        precision REAL NOT NULL,
        recall REAL NOT NULL,
        f1 REAL NOT NULL,
        mrr REAL NOT NULL,
        details TEXT NOT NULL  -- JSON
      );

      CREATE INDEX IF NOT EXISTS idx_eval_runs_timestamp
        ON eval_runs(timestamp);
    `);
  }

  /** 添加评估用例 */
  addCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
  }): EvalCase {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO eval_cases (id, query, expected_ids, language, framework, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id, query, JSON.stringify(expectedIds),
      options?.language ?? null, options?.framework ?? null, now,
    );

    return { id, query, expectedIds, language: options?.language, framework: options?.framework, createdAt: now };
  }

  /** 列出所有评估用例 */
  listCases(): EvalCase[] {
    const rows = this.db.prepare('SELECT * FROM eval_cases ORDER BY created_at').all() as any[];
    return rows.map(r => ({
      id: r.id,
      query: r.query,
      expectedIds: JSON.parse(r.expected_ids),
      language: r.language ?? undefined,
      framework: r.framework ?? undefined,
      createdAt: r.created_at,
    }));
  }

  /** 删除评估用例 */
  deleteCase(id: string): boolean {
    const result = this.db.prepare('DELETE FROM eval_cases WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * 运行完整评估
   *
   * 评估循环：每次优化后都在 holdout 集上验证效果。
   */
  async runEvaluation(topK: number = 5): Promise<EvalRunResult> {
    const cases = this.listCases();
    if (cases.length === 0) {
      return {
        runId: uuidv4(),
        timestamp: new Date().toISOString(),
        totalCases: 0,
        precision: 0,
        recall: 0,
        f1: 0,
        meanReciprocalRank: 0,
        details: [],
      };
    }

    const details: EvalCaseResult[] = [];
    let totalPrecision = 0;
    let totalRecall = 0;
    let totalMRR = 0;

    for (const evalCase of cases) {
      const results = await this.retriever.search(
        evalCase.query,
        {
          currentLanguage: evalCase.language,
          currentFramework: evalCase.framework,
        },
        undefined,
        topK,
      );

      const retrievedIds = results.map(r => r.knowledge.id);
      const hits = evalCase.expectedIds.filter(id => retrievedIds.includes(id));
      const misses = evalCase.expectedIds.filter(id => !retrievedIds.includes(id));

      const precision = retrievedIds.length > 0 ? hits.length / retrievedIds.length : 0;
      const recall = evalCase.expectedIds.length > 0 ? hits.length / evalCase.expectedIds.length : 0;

      // MRR: 第一个正确结果的排名倒数
      let mrr = 0;
      for (let i = 0; i < retrievedIds.length; i++) {
        if (evalCase.expectedIds.includes(retrievedIds[i])) {
          mrr = 1 / (i + 1);
          break;
        }
      }

      details.push({
        caseId: evalCase.id,
        query: evalCase.query,
        expectedIds: evalCase.expectedIds,
        retrievedIds,
        hits,
        misses,
        precision,
        recall,
      });

      totalPrecision += precision;
      totalRecall += recall;
      totalMRR += mrr;
    }

    const avgPrecision = totalPrecision / cases.length;
    const avgRecall = totalRecall / cases.length;
    const f1 = avgPrecision + avgRecall > 0
      ? 2 * avgPrecision * avgRecall / (avgPrecision + avgRecall)
      : 0;
    const avgMRR = totalMRR / cases.length;

    const runId = uuidv4();
    const timestamp = new Date().toISOString();

    // 保存运行结果
    this.db.prepare(`
      INSERT INTO eval_runs (id, timestamp, total_cases, precision, recall, f1, mrr, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, timestamp, cases.length, avgPrecision, avgRecall, f1, avgMRR, JSON.stringify(details));

    return {
      runId,
      timestamp,
      totalCases: cases.length,
      precision: avgPrecision,
      recall: avgRecall,
      f1,
      meanReciprocalRank: avgMRR,
      details,
    };
  }

  /** 获取评估趋势（最近 N 次运行） */
  getTrend(limit: number = 10): {
    runs: Array<{
      runId: string;
      timestamp: string;
      precision: number;
      recall: number;
      f1: number;
      mrr: number;
    }>;
    trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  } {
    const rows = this.db.prepare(`
      SELECT id, timestamp, precision, recall, f1, mrr
      FROM eval_runs
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit) as any[];

    const runs = rows.map(r => ({
      runId: r.id,
      timestamp: r.timestamp,
      precision: r.precision,
      recall: r.recall,
      f1: r.f1,
      mrr: r.mrr,
    })).reverse(); // 按时间正序

    let trend: 'improving' | 'declining' | 'stable' | 'insufficient_data' = 'insufficient_data';

    if (runs.length >= 4) {
      const recentF1 = runs.slice(-3).reduce((s, r) => s + r.f1, 0) / 3;
      const olderCount = Math.min(3, runs.length - 3);
      const olderF1 = runs.slice(0, olderCount)
        .reduce((s, r) => s + r.f1, 0) / olderCount;

      if (recentF1 > olderF1 + 0.05) trend = 'improving';
      else if (recentF1 < olderF1 - 0.05) trend = 'declining';
      else trend = 'stable';
    }

    return { runs, trend };
  }
}
