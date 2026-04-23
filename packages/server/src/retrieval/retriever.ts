/**
 * Mindstrate - Knowledge Retriever
 *
 * 混合检索：向量语义搜索 + 结构化过滤 + 质量分加权重排序。
 *
 * 新增：上下文策划模式
 * 针对特定任务自动组装最相关的知识包。
 */

import {
  KnowledgeType,
  type KnowledgeUnit,
  type RetrievalContext,
  type RetrievalFilter,
  type RetrievalResult,
  type CuratedContext,
} from '@mindstrate/protocol';
import { MetadataStore } from '../storage/metadata-store.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { Embedder } from '../processing/embedder.js';
import type { FeedbackLoop } from '../quality/feedback-loop.js';
import { daysSince, isPast } from '../math.js';

export class Retriever {
  private metadataStore: MetadataStore;
  private vectorStore: IVectorStore;
  private embedder: Embedder;
  private feedbackLoop: FeedbackLoop | null;

  constructor(
    metadataStore: MetadataStore,
    vectorStore: IVectorStore,
    embedder: Embedder,
    feedbackLoop?: FeedbackLoop,
  ) {
    this.metadataStore = metadataStore;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.feedbackLoop = feedbackLoop ?? null;
  }

  /**
   * 主检索方法
   *
   * 流程：
   * 1. 构建查询文本
   * 2. 向量语义搜索获取候选
   * 3. 从元数据库获取完整知识
   * 4. 应用过滤条件
   * 5. 重排序
   * 6. 记录反馈追踪（自动反馈闭环）
   */
  async search(
    query: string,
    context?: RetrievalContext,
    filter?: RetrievalFilter,
    topK: number = 5,
    sessionId?: string,
  ): Promise<RetrievalResult[]> {
    // Step 1: 构建增强查询
    const enrichedQuery = this.buildEnrichedQuery(query, context);

    // Step 2: 向量检索，多取一些候选
    const candidateCount = topK * 3;
    const queryEmbedding = await this.embedder.embed(enrichedQuery);

    // 构建向量库的过滤条件
    const vectorFilter = this.buildVectorFilter(filter);
    const vectorResults = await this.vectorStore.search(
      queryEmbedding,
      candidateCount,
      vectorFilter,
    );

    if (vectorResults.length === 0) {
      return [];
    }

    // Step 3: 从元数据库获取完整知识
    const ids = vectorResults.map(r => r.id);
    const knowledgeUnits = this.metadataStore.getByIds(ids);

    // 建立 ID → 向量分数 的映射
    const scoreMap = new Map<string, number>();
    for (const vr of vectorResults) {
      scoreMap.set(vr.id, vr.score);
    }

    // Step 4: 应用过滤 + 重排序
    let results: RetrievalResult[] = knowledgeUnits
      .filter(k => this.applyFilter(k, filter))
      .map(k => ({
        knowledge: k,
        relevanceScore: this.computeFinalScore(k, scoreMap.get(k.id) ?? 0),
        matchReason: this.generateMatchReason(k),
      }));

    // 按最终分数排序
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // 取 Top-K
    results = results.slice(0, topK);

    // Step 5: 记录反馈追踪（自动反馈闭环）
    if (this.feedbackLoop) {
      for (const result of results) {
        result.retrievalId = this.feedbackLoop.trackRetrieval(
          result.knowledge.id,
          query,
          sessionId,
        );
      }
    }

    return results;
  }

  /**
   * 上下文策划：针对特定任务自动组装知识包
   *
   * 不是让 AI 手动搜索，而是自动组装"执行此任务需要知道的所有相关知识"
   *
   * 组装策略：
   * 1. 搜索与任务直接相关的知识（解决方案、最佳实践）
   * 2. 搜索相关的工作流/步骤（如何执行）
   * 3. 搜索相关的反模式/踩坑记录（避免什么）
   * 4. 生成策划摘要
   */
  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    sessionId?: string,
  ): Promise<CuratedContext> {
    // 1. 搜索直接相关的解决方案知识
    const mainResults = await this.search(
      taskDescription,
      context,
      {
        project: context?.project,
        types: [
          KnowledgeType.BUG_FIX,
          KnowledgeType.BEST_PRACTICE,
          KnowledgeType.HOW_TO,
          KnowledgeType.PATTERN,
          KnowledgeType.ARCHITECTURE,
        ],
      },
      5,
      sessionId,
    );

    // 2. 搜索相关的工作流
    const workflowResults = await this.search(
      taskDescription,
      context,
      {
        project: context?.project,
        types: [KnowledgeType.WORKFLOW, KnowledgeType.CONVENTION],
      },
      3,
      sessionId,
    );

    // 3. 搜索相关的警告/踩坑
    const warningResults = await this.search(
      `common mistakes pitfalls when ${taskDescription}`,
      context,
      {
        project: context?.project,
        types: [KnowledgeType.GOTCHA, KnowledgeType.TROUBLESHOOTING],
      },
      3,
      sessionId,
    );

    // 4. 生成策划摘要
    const summary = this.generateCurationSummary(
      taskDescription,
      mainResults,
      workflowResults,
      warningResults,
    );

    return {
      taskDescription,
      knowledge: mainResults,
      workflows: workflowResults,
      warnings: warningResults,
      summary,
    };
  }

  /**
   * 生成策划摘要
   */
  private generateCurationSummary(
    task: string,
    main: RetrievalResult[],
    workflows: RetrievalResult[],
    warnings: RetrievalResult[],
  ): string {
    const parts: string[] = [];
    parts.push(`## Context for: ${task}\n`);

    if (main.length > 0) {
      parts.push(`### Relevant Knowledge (${main.length})`);
      for (const r of main) {
        parts.push(`- **${r.knowledge.title}** (${r.knowledge.type}, relevance: ${(r.relevanceScore * 100).toFixed(0)}%)`);
        if (r.knowledge.problem) {
          parts.push(`  Problem: ${r.knowledge.problem.substring(0, 100)}`);
        }
      }
    }

    if (workflows.length > 0) {
      parts.push(`\n### Recommended Workflows (${workflows.length})`);
      for (const r of workflows) {
        parts.push(`- **${r.knowledge.title}**`);
        if (r.knowledge.actionable?.steps) {
          for (const step of r.knowledge.actionable.steps.slice(0, 3)) {
            parts.push(`  ${step}`);
          }
          if (r.knowledge.actionable.steps.length > 3) {
            parts.push(`  ... and ${r.knowledge.actionable.steps.length - 3} more steps`);
          }
        }
      }
    }

    if (warnings.length > 0) {
      parts.push(`\n### Warnings & Pitfalls (${warnings.length})`);
      for (const r of warnings) {
        parts.push(`- ⚠ **${r.knowledge.title}**: ${r.knowledge.solution.substring(0, 100)}`);
      }
    }

    if (main.length === 0 && workflows.length === 0 && warnings.length === 0) {
      parts.push('No relevant knowledge found for this task.');
    }

    return parts.join('\n');
  }

  /**
   * 构建增强查询：将上下文信息融入查询文本
   */
  private buildEnrichedQuery(query: string, context?: RetrievalContext): string {
    const parts: string[] = [query];

    if (context) {
      if (context.errorMessage) {
        parts.push(`Error: ${context.errorMessage}`);
      }
      if (context.currentLanguage) {
        parts.push(`Language: ${context.currentLanguage}`);
      }
      if (context.currentFramework) {
        parts.push(`Framework: ${context.currentFramework}`);
      }
      if (context.recentCode) {
        // 只取前 500 字符避免过长
        parts.push(`Code context: ${context.recentCode.substring(0, 500)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * 构建向量库过滤条件
   */
  private buildVectorFilter(filter?: RetrievalFilter): Record<string, string | number | boolean> | undefined {
    if (!filter) return undefined;

    const where: Record<string, string | number | boolean> = {};

    if (filter.language) where['language'] = filter.language;
    if (filter.framework) where['framework'] = filter.framework;
    if (filter.project) where['project'] = filter.project;

    return Object.keys(where).length > 0 ? where : undefined;
  }

  /**
   * 应用结构化过滤条件
   */
  private applyFilter(knowledge: KnowledgeUnit, filter?: RetrievalFilter): boolean {
    if (!filter) return true;

    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(knowledge.type)) return false;
    }

    if (filter.minScore !== undefined) {
      if (knowledge.quality.score < filter.minScore) return false;
    }

    if (filter.status && filter.status.length > 0) {
      if (!filter.status.includes(knowledge.quality.status)) return false;
    }

    if (filter.tags && filter.tags.length > 0) {
      const hasTag = filter.tags.some(t => knowledge.tags.includes(t));
      if (!hasTag) return false;
    }

    return true;
  }

  /**
   * 计算最终分数：语义相似度 + 质量分加权 + 时效性衰减 + 反馈信号
   */
  private computeFinalScore(knowledge: KnowledgeUnit, semanticScore: number): number {
    // 语义相似度权重 65%（从 70% 降低以给反馈信号腾出空间）
    let score = semanticScore * 0.65;

    // 质量分权重 20%（归一化到 0-1）
    score += (knowledge.quality.score / 100) * 0.2;

    // 时效性权重 10%，不同知识类型有不同衰减速度
    score += this.computeTemporalScore(knowledge) * 0.1;

    // 反馈信号加权 5%（自动反馈闭环数据）
    if (this.feedbackLoop) {
      const stats = this.feedbackLoop.getFeedbackStats(knowledge.id);
      if (stats.total > 0) {
        score += stats.adoptionRate * 0.05;
      }
    }

    // 验证加分
    if (knowledge.quality.verified) {
      score *= 1.05; // 验证过的加 5%
    }

    // 有可执行步骤的知识加分
    if (knowledge.actionable?.steps && knowledge.actionable.steps.length > 0) {
      score *= 1.02; // 有步骤的加 2%
    }

    if (knowledge.metadata.expiresAt && isPast(knowledge.metadata.expiresAt)) {
      score *= 0.85;
    }

    return Math.min(score, 1);
  }

  private computeTemporalScore(knowledge: KnowledgeUnit): number {
    if (knowledge.metadata.expiresAt) {
      if (isPast(knowledge.metadata.expiresAt)) {
        return 0;
      }
    }

    const daysSinceUpdate = daysSince(knowledge.metadata.updatedAt);
    const freshnessWindowDays = this.getFreshnessWindowDays(knowledge.type);
    return Math.max(0, 1 - daysSinceUpdate / freshnessWindowDays);
  }

  private getFreshnessWindowDays(type: KnowledgeType): number {
    switch (type) {
      case KnowledgeType.ARCHITECTURE:
      case KnowledgeType.CONVENTION:
      case KnowledgeType.PATTERN:
      case KnowledgeType.WORKFLOW:
        return 720;
      case KnowledgeType.BEST_PRACTICE:
      case KnowledgeType.BUG_FIX:
        return 365;
      case KnowledgeType.HOW_TO:
      case KnowledgeType.GOTCHA:
      case KnowledgeType.TROUBLESHOOTING:
        return 180;
      default:
        return 365;
    }
  }

  /**
   * 生成匹配原因描述
   */
  private generateMatchReason(knowledge: KnowledgeUnit): string {
    const parts: string[] = [];

    parts.push(`Type: ${knowledge.type}`);

    if (knowledge.quality.verified) {
      parts.push('Verified');
    }

    if (knowledge.quality.useCount > 0) {
      parts.push(`Used ${knowledge.quality.useCount} times`);
    }

    if (knowledge.metadata.expiresAt && isPast(knowledge.metadata.expiresAt)) {
      parts.push('Expired');
    }

    // 显示反馈数据
    if (this.feedbackLoop) {
      const stats = this.feedbackLoop.getFeedbackStats(knowledge.id);
      if (stats.total > 0) {
        parts.push(`Adoption: ${(stats.adoptionRate * 100).toFixed(0)}%`);
      }
    }

    if (knowledge.actionable?.steps) {
      parts.push(`${knowledge.actionable.steps.length} steps`);
    }

    parts.push(`Score: ${knowledge.quality.score.toFixed(0)}`);

    return parts.join(' | ');
  }

}
