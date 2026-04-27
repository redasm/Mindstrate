/**
 * Mindstrate - LLM Knowledge Extractor
 *
 * 使用 LLM 从 git diff / commit message / 代码变更中
 * 自动提炼结构化的知识条目。
 *
 * 支持：
 * - OpenAI (GPT-4o-mini / GPT-4o)
 * - 无 API key 时退化为基于规则的提取
 */

import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import { KnowledgeType, CaptureSource } from '@mindstrate/protocol';
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from '../prompts.js';
import { LLMError } from '@mindstrate/protocol';
import { getOpenAIClient } from '../openai-client.js';
import { errorMessage, truncateText } from '../text-format.js';

export interface CommitInfo {
  hash: string;
  message: string;
  diff: string;
  author: string;
  files: string[];
}

export interface ExtractionResult {
  extracted: boolean;
  input?: CreateKnowledgeInput;
  reason: string;
}

export class KnowledgeExtractor {
  private apiKey: string;
  private baseURL?: string;
  private model: string;

  constructor(apiKey: string = '', model: string = 'gpt-4o-mini', baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
  }

  /** 从一次 commit 中提取知识 */
  async extractFromCommit(commit: CommitInfo): Promise<ExtractionResult> {
    // 先用规则判断是否值得提取
    if (!this.isWorthExtracting(commit)) {
      return { extracted: false, reason: 'Commit does not appear to contain extractable knowledge' };
    }

    // 如果有 API key，使用 LLM 提取
    if (this.apiKey) {
      return this.llmExtract(commit);
    }

    // 否则使用基于规则的提取
    return this.ruleBasedExtract(commit);
  }

  /**
   * 判断 commit 是否值得提取知识
   * 过滤掉明显的 trivial commits
   */
  private isWorthExtracting(commit: CommitInfo): boolean {
    const msg = commit.message.toLowerCase();

    // 跳过的模式
    const skipPatterns = [
      /^merge /,
      /^wip/,
      /^chore:\s*(bump|release|version)/,
      /^ci[:/]/,
      /^docs:\s*update\s*readme/,
      /^style:\s*(format|lint|prettier)/,
      /^\d+\.\d+\.\d+/,       // 版本号
      /^initial commit/,
    ];

    if (skipPatterns.some(p => p.test(msg))) {
      return false;
    }

    // diff 太短（< 5 行有效变更）可能不值得
    const addedLines = (commit.diff.match(/^\+[^+]/gm) || []).length;
    if (addedLines < 3) {
      return false;
    }

    return true;
  }

  /** 使用 LLM 提取知识 */
  private async llmExtract(commit: CommitInfo): Promise<ExtractionResult> {
    try {
      const client = await getOpenAIClient(this.apiKey, this.baseURL);
      if (!client) {
        return { extracted: false, reason: 'OpenAI client unavailable (apiKey missing or openai package not installed)' };
      }

      // 限制 diff 长度避免 token 过大
      const truncatedDiff = truncateText(commit.diff, 4016, '\n... (truncated)');

      const response = await client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: EXTRACTION_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildExtractionUserPrompt({
              hash: commit.hash,
              author: commit.author,
              message: commit.message,
              files: commit.files,
              diff: truncatedDiff,
            }),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { extracted: false, reason: 'LLM returned empty response' };
      }

      const parsed = JSON.parse(content);

      if (!parsed.worth_extracting) {
        return { extracted: false, reason: 'LLM determined commit is not knowledge-worthy' };
      }

      return {
        extracted: true,
        input: {
          type: parsed.type as KnowledgeType,
          title: parsed.title,
          problem: parsed.problem || undefined,
          solution: parsed.solution,
          tags: parsed.tags || [],
          context: {
            language: parsed.language,
            framework: parsed.framework || undefined,
            filePaths: commit.files,
          },
          author: commit.author,
          source: CaptureSource.GIT_HOOK,
          commitHash: commit.hash,
          confidence: parsed.confidence || 0.6,
        },
        reason: 'Extracted by LLM',
      };
    } catch (error) {
      const errMsg = errorMessage(error);
      // Log as LLMError but fall through to rule-based extraction
      const llmErr = new LLMError(`LLM extraction failed: ${errMsg}`, {
        commitHash: commit.hash,
        model: this.model,
      });
      return { extracted: false, reason: llmErr.message };
    }
  }

  /** 基于规则的简单提取（无 LLM 时的 fallback） */
  private ruleBasedExtract(commit: CommitInfo): ExtractionResult {
    const msg = commit.message;

    // 推断知识类型
    let type = KnowledgeType.HOW_TO;
    if (/fix[:\s]|bug[:\s]|resolve|patch/i.test(msg)) {
      type = KnowledgeType.BUG_FIX;
    } else if (/feat[:\s]|add[:\s]|implement/i.test(msg)) {
      type = KnowledgeType.PATTERN;
    } else if (/refactor/i.test(msg)) {
      type = KnowledgeType.BEST_PRACTICE;
    } else if (/workaround|hack|gotcha/i.test(msg)) {
      type = KnowledgeType.GOTCHA;
    }

    // 推断语言
    const language = this.detectLanguage(commit.files);

    // 推断框架
    const framework = this.detectFramework(commit.files, commit.diff);

    // 提取标签
    const tags = this.extractTags(msg, commit.files);

    // 生成标题
    const title = this.cleanCommitMessage(msg);

    // 从 diff 中提取变更摘要
    const solution = this.summarizeDiff(commit);

    return {
      extracted: true,
      input: {
        type,
        title,
        solution,
        tags,
        context: {
          language,
          framework,
          filePaths: commit.files,
        },
        author: commit.author,
        source: CaptureSource.GIT_HOOK,
        commitHash: commit.hash,
        confidence: 0.4, // 规则提取置信度较低
      },
      reason: 'Extracted by rules (no LLM available)',
    };
  }

  private detectLanguage(files: string[]): string {
    const extMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.rb': 'ruby',
      '.php': 'php',
      '.cs': 'csharp',
      '.cpp': 'cpp', '.cc': 'cpp', '.c': 'c',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.vue': 'vue',
      '.svelte': 'svelte',
    };

    const counts: Record<string, number> = {};
    for (const f of files) {
      const ext = f.substring(f.lastIndexOf('.'));
      const lang = extMap[ext];
      if (lang) {
        counts[lang] = (counts[lang] || 0) + 1;
      }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || 'unknown';
  }

  private detectFramework(files: string[], diff: string): string | undefined {
    const indicators: [RegExp, string][] = [
      [/next\.config|app\/.*\/page\.(tsx?|jsx?)/i, 'nextjs'],
      [/from\s+['"]react['"]|import.*React/i, 'react'],
      [/from\s+['"]vue['"]|\.vue$/i, 'vue'],
      [/from\s+['"]@angular/i, 'angular'],
      [/from\s+['"]express['"]|app\.(get|post|put|delete)\(/i, 'express'],
      [/from\s+['"]fastify['"]/, 'fastify'],
      [/from\s+['"]@nestjs/i, 'nestjs'],
      [/from\s+['"]django/i, 'django'],
      [/from\s+['"]flask/i, 'flask'],
    ];

    const combined = files.join('\n') + '\n' + diff;
    for (const [pattern, framework] of indicators) {
      if (pattern.test(combined)) {
        return framework;
      }
    }

    return undefined;
  }

  private extractTags(message: string, files: string[]): string[] {
    const tags: Set<string> = new Set();

    // 从 conventional commit 前缀提取
    const prefixMatch = message.match(/^(\w+)(?:\(([^)]+)\))?:/);
    if (prefixMatch) {
      tags.add(prefixMatch[1].toLowerCase());
      if (prefixMatch[2]) {
        tags.add(prefixMatch[2].toLowerCase());
      }
    }

    // 从文件路径提取关键目录
    for (const f of files) {
      const parts = f.split(/[/\\]/);
      for (const p of parts) {
        if (['components', 'hooks', 'utils', 'api', 'services', 'models', 'middleware'].includes(p)) {
          tags.add(p);
        }
      }
    }

    return Array.from(tags).slice(0, 8);
  }

  private cleanCommitMessage(msg: string): string {
    // 去掉 conventional commit 前缀，保留核心描述
    return msg
      .replace(/^(\w+)(?:\([^)]+\))?:\s*/, '')
      .split('\n')[0]
      .trim()
      .substring(0, 100);
  }

  private summarizeDiff(commit: CommitInfo): string {
    const parts: string[] = [];

    parts.push(`Changes in commit "${commit.message.split('\n')[0]}":`);

    // 提取新增的关键代码行
    const addedLines = commit.diff
      .split('\n')
      .filter(l => l.startsWith('+') && !l.startsWith('+++'))
      .map(l => l.substring(1).trim())
      .filter(l => l.length > 5 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('#'));

    if (addedLines.length > 0) {
      const significant = addedLines.slice(0, 10);
      parts.push(`Key changes:\n${significant.map(l => `  ${l}`).join('\n')}`);
    }

    parts.push(`Files: ${commit.files.join(', ')}`);

    return parts.join('\n');
  }
}
