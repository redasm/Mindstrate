/**
 * Mindstrate - Processing Pipeline
 *
 * ECS 写入流程已经迁移到 Mindstrate facade + context graph。
 * Pipeline 仅保留写入前的质量门禁检查。
 */

import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import type { IVectorStore } from '../storage/vector-store-interface.js';
import { Embedder } from './embedder.js';

/**
 * @deprecated These types now live in `@mindstrate/protocol`.
 * Re-exported here for backward compatibility.
 */
export type {
  PipelineResult,
  QualityGateResult,
} from '@mindstrate/protocol';

import type { QualityGateResult } from '@mindstrate/protocol';

export class Pipeline {
  constructor(
    _databaseStore?: unknown,
    _vectorStore?: IVectorStore,
    _embedder?: Embedder,
    _deduplicationThreshold: number = 0.92,
  ) {}

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
    const typesNeedingProblem = ['bug_fix', 'troubleshooting', 'gotcha'];
    const typesNeedingCode = ['bug_fix', 'pattern', 'how_to'];

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
      if (typesNeedingCode.includes(input.type)) {
        warnings.push(`Knowledge type "${input.type}" would benefit from code snippets`);
      }
    }

    // Workflow 类型特有检查
    if (input.type === 'workflow') {
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

}
