/**
 * Mindstrate - Knowledge Evolution Engine
 *
 * 知识自动进化系统
 *
 * 三大能力：
 * 1. 知识验证 — 定期检查知识是否仍然适用于当前代码库
 * 2. 知识合并 — 当多条知识描述同一领域时，合并为更完整的版本
 * 3. 知识改进 — 基于反馈轨迹，自动改进知识描述
 *
 * 核心原则（约束门禁）：
 * - 所有进化结果需要人工审核（PR 模式）
 * - 语义保持：进化后不能偏离原始目的
 * - 可回滚：通过 version 字段追踪变更
 */

import type {
  KnowledgeUnit,
  EvolutionRecord,
} from '@mindstrate/protocol';
import { KnowledgeStatus } from '@mindstrate/protocol';
import { MetadataStore } from '../storage/metadata-store.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { Embedder } from '../processing/embedder.js';
import { FeedbackLoop } from './feedback-loop.js';
import { daysSince } from '../math.js';
import { getOpenAIClient, type OpenAIClient } from '../openai-client.js';
import {
  EVOLUTION_IMPROVE_SYSTEM_PROMPT,
  buildEvolutionImproveUserPrompt,
} from '../prompts.js';

/** 进化建议 */
/**
 * @deprecated These types now live in `@mindstrate/protocol`.
 * Re-exported here for backward compatibility.
 */
export type {
  EvolutionSuggestion,
  EvolutionRunResult,
} from '@mindstrate/protocol';

import type { EvolutionSuggestion, EvolutionRunResult } from '@mindstrate/protocol';

export class KnowledgeEvolution {
  private metadataStore: MetadataStore;
  private vectorStore: IVectorStore;
  private embedder: Embedder;
  private feedbackLoop: FeedbackLoop;
  private cachedClient: OpenAIClient | null = null;
  private openaiApiKey: string;
  private openaiBaseURL?: string;
  private llmModel: string;

  constructor(
    metadataStore: MetadataStore,
    vectorStore: IVectorStore,
    embedder: Embedder,
    feedbackLoop: FeedbackLoop,
    openaiApiKey: string = '',
    options: { baseURL?: string; llmModel?: string } = {},
  ) {
    this.metadataStore = metadataStore;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.feedbackLoop = feedbackLoop;
    this.openaiApiKey = openaiApiKey;
    this.openaiBaseURL = options.baseURL;
    this.llmModel = options.llmModel ?? 'gpt-4o-mini';
  }

  /** Lazy-init OpenAI client via shared factory */
  private async getClient(): Promise<OpenAIClient | null> {
    if (!this.cachedClient) {
      this.cachedClient = await getOpenAIClient(this.openaiApiKey, this.openaiBaseURL);
    }
    return this.cachedClient;
  }

  /**
   * 运行完整的进化循环
   *
   * 5 阶段优化循环：
   * SELECT → EVALUATE → OPTIMIZE → VALIDATE → DEPLOY
   */
  async runEvolution(options: {
    /** 是否自动应用低风险改进（如废弃低质量知识） */
    autoApply?: boolean;
    /** 最大处理数量 */
    maxItems?: number;
    /** 运行模式：background 只做轻量扫描和报告，不做自动改写 */
    mode?: 'standard' | 'background';
  } = {}): Promise<EvolutionRunResult> {
    const { autoApply = false, maxItems = 100, mode = 'standard' } = options;
    const toProcess = this.metadataStore.getAll(maxItems);
    const suggestions: EvolutionSuggestion[] = [];
    const summary = {
      merge: 0,
      improve: 0,
      validate: 0,
      deprecate: 0,
      split: 0,
    };
    let autoApplied = 0;
    let llmEnhanced = 0;

    // Phase 1: 识别合并候选
    const mergeCandidates = await this.findMergeCandidates(toProcess);
    suggestions.push(...mergeCandidates);

    // Phase 2: 基于反馈轨迹识别需要改进的知识
    const improveCandidates = this.findImproveCandidates(toProcess);
    suggestions.push(...improveCandidates);

    // Phase 3: 识别应废弃的知识
    const deprecateCandidates = this.findDeprecateCandidates(toProcess);
    suggestions.push(...deprecateCandidates);

    // Phase 4: 如果有 LLM，尝试自动改进
    let openai: OpenAIClient | null = null;
    if (mode !== 'background') {
      openai = await this.getClient();
    }
    if (openai) {
      const llmImprovements = await this.llmImprove(
        improveCandidates.filter(s => s.type === 'improve')
      );
      llmEnhanced = llmImprovements.length;
      // 替换原有建议中的 suggestedUpdate
      for (const improvement of llmImprovements) {
        const idx = suggestions.findIndex(
          s => s.knowledgeId === improvement.knowledgeId && s.type === 'improve'
        );
        if (idx >= 0) {
          suggestions[idx].suggestedUpdate = improvement.suggestedUpdate;
          suggestions[idx].confidence = improvement.confidence;
        }
      }
    }

    // Phase 5: 自动应用低风险操作
    const shouldAutoApply = autoApply && mode !== 'background';
    if (shouldAutoApply) {
      for (const s of suggestions) {
        if (s.type === 'deprecate' && s.confidence >= 0.9) {
          this.metadataStore.updateStatus(s.knowledgeId, KnowledgeStatus.DEPRECATED);
          this.addEvolutionRecord(s.knowledgeId, {
            type: 'invalidated',
            timestamp: new Date().toISOString(),
            description: s.description,
          });
          autoApplied++;
        }
      }
    }

    for (const suggestion of suggestions) {
      summary[suggestion.type]++;
    }

    return {
      mode,
      scanned: toProcess.length,
      suggestions,
      summary,
      llmEnhanced,
      autoApplied,
      pendingReview: suggestions.length - autoApplied,
    };
  }

  /**
   * 寻找可合并的知识
   *
   * 反射式分析：理解"为什么"这些知识相似，然后决定如何合并。
   */
  async findMergeCandidates(
    knowledge: KnowledgeUnit[],
  ): Promise<EvolutionSuggestion[]> {
    const suggestions: EvolutionSuggestion[] = [];
    const processed = new Set<string>();

    for (const k of knowledge) {
      if (processed.has(k.id)) continue;

      // 使用向量搜索找高相似度的知识
      const text = `${k.type} ${k.title} ${k.problem ?? ''} ${k.solution}`;
      const embedding = await this.embedder.embed(text);
      const similar = await this.vectorStore.search(embedding, 5);

      const mergeCandidates = similar.filter(
        s => s.id !== k.id && s.score >= 0.80 && s.score < 0.92
      );

      if (mergeCandidates.length > 0) {
        const relatedIds = mergeCandidates.map(m => m.id);
        const relatedKnowledge = this.metadataStore.getByIds(relatedIds);

        // 只建议合并同类型、同语言的知识
        const sameType = relatedKnowledge.filter(
          rk => rk.type === k.type &&
            rk.context.language === k.context.language
        );

        if (sameType.length > 0) {
          for (const related of sameType) {
            processed.add(related.id);
          }

          suggestions.push({
            knowledgeId: k.id,
            type: 'merge',
            description:
              `Can merge with ${sameType.length} similar entries: ` +
              sameType.map(rk => `"${rk.title}" (${rk.id.substring(0, 8)})`).join(', '),
            confidence: 0.7,
            relatedIds: sameType.map(rk => rk.id),
          });
        }
      }

      processed.add(k.id);
    }

    return suggestions;
  }

  /**
   * 基于反馈轨迹寻找需要改进的知识
   *
   * 执行轨迹分析：读取反馈事件来理解"为什么"知识被拒绝。
   */
  findImproveCandidates(
    knowledge: KnowledgeUnit[],
  ): EvolutionSuggestion[] {
    const suggestions: EvolutionSuggestion[] = [];

    for (const k of knowledge) {
      const stats = this.feedbackLoop.getFeedbackStats(k.id);

      // 有足够的反馈数据且采纳率低
      if (stats.total >= 3 && stats.adoptionRate < 0.4) {
        suggestions.push({
          knowledgeId: k.id,
          type: 'improve',
          description:
            `Low adoption rate (${(stats.adoptionRate * 100).toFixed(0)}%). ` +
            `Retrieved ${stats.total} times, adopted only ${stats.adopted} times. ` +
            `Consider improving the solution description or adding code examples.`,
          confidence: Math.min(0.9, 0.5 + (stats.total - 3) * 0.05),
        });
      }

      // 高检索量但被频繁拒绝
      if (stats.total >= 5 && stats.rejected > stats.adopted) {
        suggestions.push({
          knowledgeId: k.id,
          type: 'improve',
          description:
            `Frequently rejected (${stats.rejected}/${stats.total}). ` +
            `The knowledge may be inaccurate or outdated.`,
          confidence: 0.85,
        });
      }
    }

    return suggestions;
  }

  /**
   * 识别应该废弃的知识
   */
  findDeprecateCandidates(
    knowledge: KnowledgeUnit[],
  ): EvolutionSuggestion[] {
    const suggestions: EvolutionSuggestion[] = [];

    for (const k of knowledge) {
      if (k.quality.status === KnowledgeStatus.DEPRECATED) continue;

      const stats = this.feedbackLoop.getFeedbackStats(k.id);

      // 条件 1：质量分极低
      if (k.quality.score < 15) {
        suggestions.push({
          knowledgeId: k.id,
          type: 'deprecate',
          description: `Quality score critically low (${k.quality.score.toFixed(0)}/100)`,
          confidence: 0.95,
        });
        continue;
      }

      // 条件 2：被大量拒绝且无采纳
      if (stats.total >= 5 && stats.adopted === 0 && stats.rejected >= 3) {
        suggestions.push({
          knowledgeId: k.id,
          type: 'deprecate',
          description:
            `Never adopted in ${stats.total} retrievals, rejected ${stats.rejected} times`,
          confidence: 0.9,
        });
        continue;
      }

      // 条件 3：超过一年未使用且分数低
      const daysSinceUse = k.quality.lastUsedAt
        ? daysSince(k.quality.lastUsedAt)
        : daysSince(k.metadata.createdAt);
      if (daysSinceUse > 365 && k.quality.score < 40) {
        suggestions.push({
          knowledgeId: k.id,
          type: 'deprecate',
          description: `Unused for ${daysSinceUse} days with low score (${k.quality.score.toFixed(0)})`,
          confidence: 0.8,
        });
      }
    }

    return suggestions;
  }

  /**
   * 使用 LLM 自动改进知识
   *
   * 变异 + 评估循环
   */
  private async llmImprove(
    candidates: EvolutionSuggestion[],
  ): Promise<EvolutionSuggestion[]> {
    const openai = await this.getClient();
    if (!openai || candidates.length === 0) return [];

    const improved: EvolutionSuggestion[] = [];

    for (const candidate of candidates.slice(0, 5)) { // 限制每次最多改进 5 条
      const knowledge = this.metadataStore.getById(candidate.knowledgeId);
      if (!knowledge) continue;

      try {
        const response = await openai.chat.completions.create({
          model: this.llmModel,
          messages: [
            {
              role: 'system',
              content: EVOLUTION_IMPROVE_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: buildEvolutionImproveUserPrompt({
                currentTitle: knowledge.title,
                currentProblem: knowledge.problem,
                currentSolution: knowledge.solution,
                currentTags: knowledge.tags,
                type: knowledge.type,
                language: knowledge.context.language,
                framework: knowledge.context.framework,
                feedbackIssue: candidate.description,
              }),
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          improved.push({
            ...candidate,
            confidence: 0.7,
            suggestedUpdate: {
              title: parsed.title ?? knowledge.title,
              problem: parsed.problem ?? knowledge.problem,
              solution: parsed.solution ?? knowledge.solution,
              tags: parsed.tags ?? knowledge.tags,
            },
          });
        }
      } catch (err) {
        // LLM 调用失败，跳过此条，继续处理其他
        console.warn(
          `[KnowledgeEvolution] LLM improve failed for ${candidate.knowledgeId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return improved;
  }

  /**
   * 应用一个进化建议（人工审核后调用）
   */
  applySuggestion(suggestion: EvolutionSuggestion): boolean {
    const knowledge = this.metadataStore.getById(suggestion.knowledgeId);
    if (!knowledge) return false;

    const scoreBefore = knowledge.quality.score;

    switch (suggestion.type) {
      case 'improve':
        if (suggestion.suggestedUpdate) {
          this.metadataStore.update(suggestion.knowledgeId, suggestion.suggestedUpdate);
          this.addEvolutionRecord(suggestion.knowledgeId, {
            type: 'improved',
            timestamp: new Date().toISOString(),
            description: suggestion.description,
            scoreBefore,
          });
        }
        return true;

      case 'deprecate':
        this.metadataStore.updateStatus(suggestion.knowledgeId, KnowledgeStatus.DEPRECATED);
        this.addEvolutionRecord(suggestion.knowledgeId, {
          type: 'invalidated',
          timestamp: new Date().toISOString(),
          description: suggestion.description,
          scoreBefore,
        });
        return true;

      case 'merge':
        // 合并需要单独处理（保留最好的那条，废弃其他的）
        if (suggestion.relatedIds) {
          this.mergeKnowledge(suggestion.knowledgeId, suggestion.relatedIds);
        }
        return true;

      case 'validate':
        this.addEvolutionRecord(suggestion.knowledgeId, {
          type: 'validated',
          timestamp: new Date().toISOString(),
          description: suggestion.description,
        });
        return true;

      default:
        return false;
    }
  }

  /**
   * 合并多条知识为一条
   */
  private mergeKnowledge(primaryId: string, mergeIds: string[]): void {
    const primary = this.metadataStore.getById(primaryId);
    if (!primary) return;

    const toMerge = this.metadataStore.getByIds(mergeIds);

    // 合并策略：保留 primary，将其他知识的信息补充进去
    const mergedTags = new Set(primary.tags);
    const mergedSolution = [primary.solution];
    const mergedSnippets = [...(primary.codeSnippets ?? [])];

    for (const k of toMerge) {
      k.tags.forEach(t => mergedTags.add(t));

      // 追加有价值的补充内容
      if (k.solution && k.solution !== primary.solution) {
        mergedSolution.push(`\n\n---\n[Merged from "${k.title}"]\n${k.solution}`);
      }

      if (k.codeSnippets) {
        mergedSnippets.push(...k.codeSnippets);
      }

      // 废弃被合并的条目
      this.metadataStore.updateStatus(k.id, KnowledgeStatus.DEPRECATED);
      this.addEvolutionRecord(k.id, {
        type: 'merged',
        timestamp: new Date().toISOString(),
        description: `Merged into "${primary.title}" (${primaryId})`,
        relatedIds: [primaryId],
      });
    }

    // 更新主条目
    this.metadataStore.update(primaryId, {
      solution: mergedSolution.join(''),
      tags: Array.from(mergedTags),
      codeSnippets: mergedSnippets,
    });

    this.addEvolutionRecord(primaryId, {
      type: 'merged',
      timestamp: new Date().toISOString(),
      description: `Merged ${mergeIds.length} related entries`,
      relatedIds: mergeIds,
    });
  }

  /**
   * 为知识添加进化记录
   *
   * 谱系追踪：每次进化都有完整记录，支持回滚。
   */
  private addEvolutionRecord(
    knowledgeId: string,
    record: EvolutionRecord,
  ): void {
    const knowledge = this.metadataStore.getById(knowledgeId);
    if (!knowledge) return;

    const evolution = knowledge.evolution ?? [];
    evolution.push(record);

    // 通过 metadata-store 的原始 DB 更新 evolution 字段
    // 因为 UpdateKnowledgeInput 不包含 evolution，我们直接操作
    this.metadataStore.updateEvolution(knowledgeId, evolution);
  }

}
