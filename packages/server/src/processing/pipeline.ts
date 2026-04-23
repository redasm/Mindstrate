/**
 * Mindstrate - Processing Pipeline
 *
 * 知识处理流水线：
 * 1. 质量门禁检查（结构完整性 + 一致性检测）
 * 2. 去重检测
 * 3. 内容标准化
 * 4. Embedding 生成
 * 5. 写入存储
 */

import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import { KnowledgeType } from '@mindstrate/protocol';
import { MetadataStore } from '../storage/metadata-store.js';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { Embedder } from './embedder.js';
import { ValidationError, DuplicateError, StorageError } from '@mindstrate/protocol';

/**
 * @deprecated These types now live in `@mindstrate/protocol`.
 * Re-exported here for backward compatibility.
 */
export type {
  PipelineResult,
  QualityGateResult,
} from '@mindstrate/protocol';

import type { PipelineResult, QualityGateResult } from '@mindstrate/protocol';

export class Pipeline {
  private metadataStore: MetadataStore;
  private vectorStore: IVectorStore;
  private embedder: Embedder;
  private deduplicationThreshold: number;

  constructor(
    metadataStore: MetadataStore,
    vectorStore: IVectorStore,
    embedder: Embedder,
    deduplicationThreshold: number = 0.92,
  ) {
    this.metadataStore = metadataStore;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.deduplicationThreshold = deduplicationThreshold;
  }

  /** 处理一条新知识 */
  async process(input: CreateKnowledgeInput): Promise<PipelineResult> {
    try {
      // Step 0: 质量门禁检查（约束门禁）
      const gateResult = this.qualityGate(input);
      if (!gateResult.passed) {
        return {
          success: false,
          message: `Quality gate failed: ${gateResult.errors.join('; ')}`,
          qualityWarnings: gateResult.warnings,
        };
      }

      // Step 1: 标准化输入
      const normalized = this.normalize(input);

      // Step 2: 生成 Embedding
      const text = this.embedder.knowledgeToText(normalized);
      const embedding = await this.embedder.embed(text);

      // Step 3: 去重检测
      const duplicates = await this.vectorStore.findDuplicates(
        embedding,
        this.deduplicationThreshold,
      );

      if (duplicates.length > 0) {
        const dup = duplicates[0];
        // 找到重复项，记录使用而非新增
        this.metadataStore.recordUsage(dup.id);
        return {
          success: false,
          message: `Duplicate detected (similarity: ${(dup.score * 100).toFixed(1)}%). Existing knowledge ID: ${dup.id}`,
          duplicateOf: dup.id,
        };
      }

      // Step 4: 一致性检测（检查是否与已有知识矛盾）
      const contradictions = await this.checkContradictions(embedding, normalized);

      // Step 5: 写入元数据库
      const knowledge = this.metadataStore.create(normalized);

      // Step 6: 写入向量库
      await this.vectorStore.add({
        id: knowledge.id,
        embedding,
        text,
        metadata: {
          type: knowledge.type,
          language: knowledge.context.language ?? '',
          framework: knowledge.context.framework ?? '',
          project: knowledge.context.project ?? '',
        },
      });

      // 收集所有警告
      const warnings = [
        ...gateResult.warnings,
        ...contradictions,
      ];

      return {
        success: true,
        knowledge,
        message: `Knowledge added successfully: ${knowledge.title}`,
        qualityWarnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof DuplicateError || error instanceof StorageError) {
        return {
          success: false,
          message: error.message,
          duplicateOf: error instanceof DuplicateError ? error.duplicateOf : undefined,
        };
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to process knowledge: ${errMsg}`,
      };
    }
  }

  /**
   * 质量门禁：结构完整性检查
   *
   * 每个写入的知识都必须通过结构完整性验证。
   */
  qualityGate(input: CreateKnowledgeInput): QualityGateResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 0;
    const maxScore = 100;

    // === 必要字段检查 ===
    if (!input.title?.trim()) {
      errors.push('Title is required and cannot be empty');
    } else {
      score += 15;
      if (input.title.trim().length < 5) {
        warnings.push('Title is very short (< 5 chars), consider being more descriptive');
      }
    }

    if (!input.solution?.trim()) {
      errors.push('Solution is required and cannot be empty');
    } else {
      score += 20;
      if (input.solution.trim().length < 20) {
        warnings.push('Solution is very short (< 20 chars), consider adding more detail');
      }
    }

    if (!input.type) {
      errors.push('Knowledge type is required');
    } else {
      score += 10;
    }

    // === 结构丰富度检查 ===

    // 问题描述（对 bug_fix / troubleshooting / gotcha 尤其重要）
    if (input.problem?.trim()) {
      score += 15;
    } else if (input.type) {
      const typesNeedingProblem = [
        KnowledgeType.BUG_FIX,
        KnowledgeType.TROUBLESHOOTING,
        KnowledgeType.GOTCHA,
      ];
      if (typesNeedingProblem.includes(input.type)) {
        warnings.push(`Knowledge type "${input.type}" should include a problem description`);
      }
    }

    // 标签
    if (input.tags && input.tags.length > 0) {
      score += 10;
    } else {
      warnings.push('No tags provided — tags improve discoverability');
    }

    // 上下文（语言/框架）
    if (input.context?.language) {
      score += 10;
    } else {
      warnings.push('No programming language specified');
    }

    if (input.context?.framework) {
      score += 5;
    }

    // 代码片段
    if (input.codeSnippets && input.codeSnippets.length > 0) {
      score += 10;
    } else {
      const typesNeedingCode = [
        KnowledgeType.BUG_FIX,
        KnowledgeType.PATTERN,
        KnowledgeType.HOW_TO,
      ];
      if (typesNeedingCode.includes(input.type)) {
        warnings.push(`Knowledge type "${input.type}" would benefit from code snippets`);
      }
    }

    // Workflow 类型特有检查
    if (input.type === KnowledgeType.WORKFLOW) {
      if (!input.actionable?.steps || input.actionable.steps.length === 0) {
        warnings.push('Workflow knowledge should include actionable steps');
      } else {
        score += 5;
      }
    }

    // 可执行指导加分
    if (input.actionable) {
      if (input.actionable.steps?.length) score += 3;
      if (input.actionable.preconditions?.length) score += 1;
      if (input.actionable.verification) score += 1;
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      completenessScore: Math.min(score, maxScore),
    };
  }

  /**
   * 一致性检测：检查新知识是否与已有知识存在潜在矛盾
   *
   * 语义保持约束：确保新知识不会与已验证的知识产生冲突。
   */
  private async checkContradictions(
    embedding: number[],
    input: CreateKnowledgeInput,
  ): Promise<string[]> {
    const warnings: string[] = [];

    // 查找相似但不重复的知识（0.75 - deduplicationThreshold）
    const similar = await this.vectorStore.search(embedding, 5);
    const nearMatches = similar.filter(
      s => s.score >= 0.75 && s.score < this.deduplicationThreshold
    );

    if (nearMatches.length > 0) {
      const ids = nearMatches.map(m => m.id);
      const existingEntries = this.metadataStore.getByIds(ids);

      for (const existing of existingEntries) {
        // 同类型、同语言的高相似度知识
        if (
          existing.type === input.type &&
          existing.context.language === input.context?.language &&
          existing.quality.status === 'verified'
        ) {
          warnings.push(
            `Potentially contradicts verified knowledge "${existing.title}" (ID: ${existing.id}). ` +
            `Review for consistency.`
          );
        }

        // 相似度较高的知识提示可能需要合并
        const matchScore = nearMatches.find(m => m.id === existing.id)?.score ?? 0;
        if (matchScore >= 0.85) {
          warnings.push(
            `Very similar to existing knowledge "${existing.title}" (${(matchScore * 100).toFixed(1)}% similar). ` +
            `Consider merging instead of adding new.`
          );
        }
      }
    }

    return warnings;
  }

  /** 标准化输入 */
  private normalize(input: CreateKnowledgeInput): CreateKnowledgeInput {
    return {
      ...input,
      title: input.title.trim(),
      problem: input.problem?.trim(),
      solution: input.solution.trim(),
      tags: (input.tags ?? []).map(t => t.toLowerCase().trim()).filter(Boolean),
      context: {
        ...input.context,
        language: input.context?.language?.toLowerCase(),
        framework: input.context?.framework?.toLowerCase(),
        project: input.context?.project?.trim(),
      },
    };
  }
}
