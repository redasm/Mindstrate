/**
 * Mindstrate - Quality Scorer
 *
 * 知识质量评分与生命周期管理。
 *
 * 增强：融合自动反馈信号（采纳率）和进化谱系加分。
 */

import {
  type KnowledgeUnit,
  KnowledgeStatus,
  CaptureSource,
} from '@mindstrate/protocol';
import { MetadataStore } from '../storage/metadata-store.js';
import type { FeedbackLoop } from './feedback-loop.js';
import { daysSince } from '../math.js';

export class QualityScorer {
  private metadataStore: MetadataStore;
  private feedbackLoop: FeedbackLoop | null;

  constructor(metadataStore: MetadataStore, feedbackLoop?: FeedbackLoop) {
    this.metadataStore = metadataStore;
    this.feedbackLoop = feedbackLoop ?? null;
  }

  /** 计算单条知识的质量分 */
  calculateScore(knowledge: KnowledgeUnit): number {
    let score = 50; // 基础分

    // 使用反馈
    score += knowledge.quality.upvotes * 5;
    score -= knowledge.quality.downvotes * 10; // 差评惩罚更大

    // 使用频率（上限 20 分）
    score += Math.min(knowledge.quality.useCount * 2, 20);

    // 时效性衰减：每 30 天未使用扣 2 分
    if (knowledge.quality.lastUsedAt) {
      const daysSinceLastUse = daysSince(knowledge.quality.lastUsedAt);
      score -= Math.floor(daysSinceLastUse / 30) * 2;
    }

    // 人工验证加分
    if (knowledge.quality.verified) {
      score += 15;
    }

    // 来源加权
    if (knowledge.metadata.source === CaptureSource.PR_REVIEW) score += 5;
    if (knowledge.metadata.source === CaptureSource.AI_CONVERSATION) score += 2;

    // 置信度加权
    score += (knowledge.metadata.confidence - 0.5) * 10;

    // === 新增：自动反馈闭环信号 ===
    if (this.feedbackLoop) {
      const stats = this.feedbackLoop.getFeedbackStats(knowledge.id);
      if (stats.total >= 3) {
        // 高采纳率加分（最多 +10）
        score += Math.round(stats.adoptionRate * 10);
        // 高拒绝率扣分（最多 -10）
        const rejectRate = stats.rejected / stats.total;
        score -= Math.round(rejectRate * 10);
      }
    }

    // === 新增：进化谱系加分 ===
    if (knowledge.evolution && knowledge.evolution.length > 0) {
      // 经过改进的知识加分
      const improvements = knowledge.evolution.filter(e => e.type === 'improved').length;
      score += Math.min(improvements * 3, 9); // 最多 +9（3 次改进）

      // 经过验证的知识加分
      const validations = knowledge.evolution.filter(e => e.type === 'validated').length;
      score += Math.min(validations * 5, 10); // 最多 +10

      // 合并了其他知识的加分（信息更全面）
      const merges = knowledge.evolution.filter(e => e.type === 'merged').length;
      score += Math.min(merges * 2, 6); // 最多 +6
    }

    // === 新增：结构完整性加分 ===
    if (knowledge.actionable) {
      if (knowledge.actionable.steps?.length) score += 3;
      if (knowledge.actionable.preconditions?.length) score += 1;
      if (knowledge.actionable.verification) score += 1;
      if (knowledge.actionable.antiPatterns?.length) score += 2;
    }

    return this.clamp(score, 0, 100);
  }

  /** 确定知识的生命周期状态 */
  determineStatus(knowledge: KnowledgeUnit, precomputedScore?: number): KnowledgeStatus {
    const score = precomputedScore ?? this.calculateScore(knowledge);

    // 分数太低 → 废弃
    if (score < 20) {
      return KnowledgeStatus.DEPRECATED;
    }

    // 已验证且分数高 → 保持验证状态
    if (knowledge.quality.verified && score >= 30) {
      return KnowledgeStatus.VERIFIED;
    }

    // 被使用过 3 次以上且有正面评价 → 活跃
    if (knowledge.quality.useCount >= 3 && knowledge.quality.upvotes > knowledge.quality.downvotes) {
      return KnowledgeStatus.ACTIVE;
    }

    // 新增：高采纳率也可以激活
    if (this.feedbackLoop) {
      const stats = this.feedbackLoop.getFeedbackStats(knowledge.id);
      if (stats.total >= 5 && stats.adoptionRate >= 0.6) {
        return KnowledgeStatus.ACTIVE;
      }
    }

    // 6 个月未使用 → 可能过时
    if (knowledge.quality.lastUsedAt) {
      const daysSinceUse = daysSince(knowledge.quality.lastUsedAt);
      if (daysSinceUse > 180) {
        return KnowledgeStatus.OUTDATED;
      }
    } else {
      // 创建后 6 个月从未被使用
      const daysSinceCreate = daysSince(knowledge.metadata.createdAt);
      if (daysSinceCreate > 180) {
        return KnowledgeStatus.OUTDATED;
      }
    }

    return KnowledgeStatus.PROBATION;
  }

  /** 执行全量维护：重新评分 + 更新状态（使用事务批量更新） */
  runMaintenance(): {
    total: number;
    updated: number;
    deprecated: number;
    outdated: number;
  } {
    const allKnowledge = this.metadataStore.getAll();
    let updated = 0;
    let deprecated = 0;
    let outdated = 0;

    // Collect all updates first, then apply in batch
    const scoreUpdates: Array<{ id: string; score: number }> = [];
    const statusUpdates: Array<{ id: string; status: KnowledgeStatus }> = [];

    for (const k of allKnowledge) {
      const newScore = this.calculateScore(k);
      const newStatus = this.determineStatus(k, newScore);

      const scoreChanged = Math.abs(newScore - k.quality.score) > 0.5;
      const statusChanged = newStatus !== k.quality.status;

      if (scoreChanged) {
        scoreUpdates.push({ id: k.id, score: newScore });
      }

      if (statusChanged) {
        statusUpdates.push({ id: k.id, status: newStatus });
        if (newStatus === KnowledgeStatus.DEPRECATED) deprecated++;
        if (newStatus === KnowledgeStatus.OUTDATED) outdated++;
      }

      if (scoreChanged || statusChanged) {
        updated++;
      }
    }

    // Apply all updates within the same implicit transaction (better-sqlite3 auto-wraps)
    for (const { id, score } of scoreUpdates) {
      this.metadataStore.updateScore(id, score);
    }
    for (const { id, status } of statusUpdates) {
      this.metadataStore.updateStatus(id, status);
    }

    return {
      total: allKnowledge.length,
      updated,
      deprecated,
      outdated,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
