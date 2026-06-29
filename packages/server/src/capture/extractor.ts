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

import type { CreateKnowledgeInput, CodeSnippet, ActionableGuide } from '@mindstrate/protocol';
import { KnowledgeType, CaptureSource } from '@mindstrate/protocol';
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
} from '../prompts.js';
import { contentLanguageInstruction } from '../content-locale.js';
import { LLMError } from '@mindstrate/protocol';
import type { ProviderFactory } from '../processing/provider-factory.js';
import { errorMessage, truncateText } from '@mindstrate/protocol/text';

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
  constructor(private readonly providerFactory: ProviderFactory) {}

  /** 从一次 commit 中提取知识 */
  async extractFromCommit(commit: CommitInfo, project: string = ''): Promise<ExtractionResult> {
    // 先用规则判断是否值得提取
    if (!this.isWorthExtracting(commit)) {
      return { extracted: false, reason: 'Commit does not appear to contain extractable knowledge' };
    }

    const providers = this.providerFactory.forProject(project);

    // 如果有配置，使用 LLM 提取
    if (providers.hasConfig) {
      return this.llmExtract(commit, providers, project);
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

    // 文件路径过滤：只有当 commit 触及"有意义的源文件"时才值得提取知识。
    // 一个只改了生成产物 / 测试 / 锁文件 / 纯配置·资源·文档的 commit,几乎不可能
    // 沉淀出可复用的工程知识——把它喂给 LLM 只会产出噪音卡片。借鉴确定性
    // 文件过滤(先剔除噪音,再交给 LLM)的思路,在此处提前挡掉。
    if (commit.files.length > 0 && !commit.files.some((file) => this.isMeaningfulSourceFile(file))) {
      return false;
    }

    // diff 太短（< 3 行有效变更）可能不值得。统计 git 统一 diff 的 `+`
    // 新增行,同时兼容 Perforce 默认 ed 格式的 `>` 新增行,避免 P4 来源
    // 因 diff 格式不同而被整体误判为"无变更"。
    const gitAdded = (commit.diff.match(/^\+[^+]/gm) || []).length;
    const p4Added = (commit.diff.match(/^>/gm) || []).length;
    if (gitAdded + p4Added < 3) {
      return false;
    }

    return true;
  }

  /**
   * 判断单个文件是否是"有意义的源文件"——值得从中提炼知识。
   * 排除生成产物、测试、锁文件,以及纯配置/资源/文档类文件。
   * 注意:这是项目无关的内置启发式;项目专属的生成目录(如 Unreal 的
   * `TypeScript/Typing`、`Content`)由扫描的 graphHints `ignore`/`generatedRoots`
   * 在更上游剔除,这里只兜底通用噪音。
   */
  private isMeaningfulSourceFile(file: string): boolean {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const base = normalized.substring(normalized.lastIndexOf('/') + 1);

    // 生成 / 构建产物目录（匹配路径任意层级，含位于根的目录前缀）
    const generatedDirs = [
      'node_modules', 'dist', 'build', 'out', 'bin', 'obj',
      'generated', '.next', 'coverage', '__snapshots__',
      'binaries', 'intermediate', 'saved', 'deriveddatacache',
    ];
    const segments = normalized.split('/');
    if (segments.some((seg) => generatedDirs.includes(seg))) return false;
    // Unreal 生成的 TS 声明目录（两段连续）
    if (normalized.includes('typescript/typing/')) return false;

    // 测试文件
    if (/(^|\/)tests?\//.test(normalized)) return false;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)) return false;

    // 锁文件 / 明确的噪音文件名
    const noiseBasenames = new Set([
      'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
      'go.sum', 'cargo.lock', 'poetry.lock', 'gemfile.lock',
      '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.prettierrc',
      'license', 'license.txt', 'license.md', 'changelog.md',
    ]);
    if (noiseBasenames.has(base)) return false;

    // 纯配置 / 数据 / 资源 / 文档类扩展名(不承载可复用的代码知识)
    const noiseExtensions = [
      '.md', '.markdown', '.txt', '.rst',
      '.json', '.yaml', '.yml', '.toml', '.ini', '.xml', '.csv',
      '.lock', '.log', '.map', '.snap',
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
      '.mp3', '.wav', '.ogg', '.ttf', '.otf', '.woff', '.woff2',
      '.uasset', '.umap', '.bin', '.dat',
    ];
    if (noiseExtensions.some((ext) => base.endsWith(ext))) return false;

    return true;
  }

  /** 使用 LLM 提取知识 */
  private async llmExtract(
    commit: CommitInfo,
    providers: { llmClientPromise: Promise<unknown>; llmModel: string },
    project: string,
  ): Promise<ExtractionResult> {
    try {
      const client = (await providers.llmClientPromise) as Awaited<ReturnType<typeof import('../openai-client.js').getOpenAIClient>>;
      if (!client) {
        return { extracted: false, reason: 'OpenAI client unavailable (apiKey missing or openai package not installed)' };
      }

      // 限制 diff 长度避免 token 过大。结构化富提取需要更多上下文,
      // 因此放宽到 ~12k 字符(原 4016 只能看到大改动的开头)。
      const truncatedDiff = truncateText(commit.diff, 12000, '\n... (truncated)');

      const response = await client.chat.completions.create({
        model: providers.llmModel,
        temperature: 0.2,
        // 富结构化输出(多段 solution + 代码片段 + actionable)需要足够的
        // 输出预算,否则会被服务端默认上限截断成半句话。推理模型(如
        // deepseek-v4-pro 默认思考)还会先消耗大量 token 思考,故再放宽。
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildExtractionSystemPrompt(contentLanguageInstruction()),
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

      const codeSnippets = this.mapCodeSnippets(parsed.code_snippets, commit.files);
      const actionable = this.mapActionable(parsed.actionable);
      const solution = this.composeSolutionBody(parsed.solution, parsed.key_points, codeSnippets);

      return {
        extracted: true,
        input: {
          type: parsed.type as KnowledgeType,
          title: parsed.title,
          problem: parsed.problem || undefined,
          solution,
          codeSnippets: codeSnippets.length > 0 ? codeSnippets : undefined,
          actionable,
          tags: parsed.tags || [],
          context: {
            project: project || undefined,
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
      });
      return { extracted: false, reason: llmErr.message };
    }
  }

  /**
   * 将 LLM 返回的结构化片段组装成卡片正文(Markdown)。
   * 卡片只渲染 content(=solution),所以把要点和关键代码拼进正文,
   * 让读者在卡片里就能看到完整信息;结构化字段(codeSnippets/actionable)
   * 仍单独保留,用于质量门评分与未来的程序化消费。
   */
  private composeSolutionBody(
    solution: unknown,
    keyPoints: unknown,
    codeSnippets: CodeSnippet[],
  ): string {
    const sections: string[] = [];
    const body = typeof solution === 'string' ? solution.trim() : '';
    if (body) sections.push(body);

    const points = Array.isArray(keyPoints)
      ? keyPoints.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : [];
    if (points.length > 0 && !body.includes('## 要点')) {
      sections.push(['## 要点 / Key points', ...points.map((p) => `- ${p.trim()}`)].join('\n'));
    }

    if (codeSnippets.length > 0 && !/```/.test(body)) {
      const blocks = codeSnippets.map((s) => {
        const header = [s.description, s.filePath ? `(${s.filePath})` : '']
          .filter(Boolean)
          .join(' ');
        return [header ? `**${header}**` : '', '```' + (s.language || ''), s.code, '```']
          .filter(Boolean)
          .join('\n');
      });
      sections.push(['## 关键代码 / Key code', ...blocks].join('\n\n'));
    }

    const composed = sections.join('\n\n').trim();
    return composed.length > 0 ? composed : (body || 'No solution extracted.');
  }

  /** 规整 LLM 返回的代码片段 */
  private mapCodeSnippets(raw: unknown, files: string[]): CodeSnippet[] {
    if (!Array.isArray(raw)) return [];
    const fallbackLang = this.detectLanguage(files);
    const snippets: CodeSnippet[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const code = typeof rec['code'] === 'string' ? rec['code'].trim() : '';
      if (!code) continue;
      snippets.push({
        language: typeof rec['language'] === 'string' && rec['language'] ? rec['language'] : fallbackLang,
        code,
        filePath: typeof rec['file_path'] === 'string' ? rec['file_path'] : undefined,
        description: typeof rec['description'] === 'string' ? rec['description'] : undefined,
      });
    }
    return snippets.slice(0, 6);
  }

  /** 规整 LLM 返回的可执行指导 */
  private mapActionable(raw: unknown): ActionableGuide | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const rec = raw as Record<string, unknown>;
    const strArray = (v: unknown): string[] | undefined => {
      if (!Array.isArray(v)) return undefined;
      const arr = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
      return arr.length > 0 ? arr : undefined;
    };
    const guide: ActionableGuide = {
      preconditions: strArray(rec['preconditions']),
      steps: strArray(rec['steps']),
      verification: typeof rec['verification'] === 'string' && rec['verification'].trim() ? rec['verification'].trim() : undefined,
      antiPatterns: strArray(rec['anti_patterns']),
    };
    const hasContent = guide.preconditions || guide.steps || guide.verification || guide.antiPatterns;
    return hasContent ? guide : undefined;
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
