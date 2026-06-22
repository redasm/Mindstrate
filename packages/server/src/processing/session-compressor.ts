/**
 * Mindstrate - Session Compressor
 *
 * 将会话中的观察记录压缩为结构化摘要。
 * 支持两种模式：
 * 1. LLM 压缩（有 API key 时，高质量）
 * 2. 规则压缩（无 API key 时，从观察记录中提取关键信息）
 */

import type { Session, CompressSessionInput, SessionObservation } from '@mindstrate/protocol';
import {
  buildSessionCompressionSystemPrompt,
  buildSessionCompressionUserPrompt,
} from '../prompts.js';
import { contentLanguageInstruction } from '../content-locale.js';
import { noopLogger, type Logger } from '../runtime/logger.js';
import type { ProviderFactory } from './provider-factory.js';

export class SessionCompressor {
  private logger: Logger;

  constructor(
    private readonly providerFactory: ProviderFactory,
    logger: Logger = noopLogger,
  ) {
    this.logger = logger;
  }

  /** 压缩会话为结构化摘要 */
  async compress(session: Session): Promise<CompressSessionInput> {
    const observations = session.observations ?? [];
    const providers = this.providerFactory.forProject(session.project);

    if (providers.hasConfig && observations.length > 0) {
      return this.llmCompress(session, observations, providers);
    }
    return this.ruleCompress(session, observations);
  }

  /** LLM 压缩 */
  private async llmCompress(
    session: Session,
    observations: SessionObservation[],
    providers: { llmClientPromise: Promise<unknown>; llmModel: string },
  ): Promise<CompressSessionInput> {
    try {
      const client = (await providers.llmClientPromise) as Awaited<ReturnType<typeof import('../openai-client.js').getOpenAIClient>>;
      if (!client) return this.ruleCompress(session, observations);

      const obsText = observations
        .map(o => `[${o.type}] ${o.content}`)
        .join('\n');

      const response = await client.chat.completions.create({
        model: providers.llmModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildSessionCompressionSystemPrompt(contentLanguageInstruction()),
          },
          {
            role: 'user',
            content: buildSessionCompressionUserPrompt({
              project: session.project,
              techContext: session.techContext,
              startedAt: session.startedAt,
              observationsText: obsText,
              observationCount: observations.length,
            }),
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return this.ruleCompress(session, observations);

      const parsed = JSON.parse(content);
      return {
        sessionId: session.id,
        summary: parsed.summary || '',
        decisions: parsed.decisions || [],
        openTasks: parsed.openTasks || [],
        problemsSolved: parsed.problemsSolved || [],
        filesModified: parsed.filesModified || [],
      };
    } catch (err) {
      // LLM compression failed, fall back to rule-based
      this.logger.warn(
        `[SessionCompressor] LLM compression failed, using rule-based fallback: ${err instanceof Error ? err.message : String(err)}`
      );
      return this.ruleCompress(session, observations);
    }
  }

  /** 规则压缩（fallback） */
  private ruleCompress(session: Session, observations: SessionObservation[]): CompressSessionInput {
    const decisions = observations
      .filter(o => o.type === 'decision' || o.type === 'decision_path')
      .map(o => o.content);

    const problemsSolved = observations
      .filter(o => o.type === 'problem_solved')
      .map(o => o.content);

    // 失败路径也作为重要信息记录
    const failedPaths = observations
      .filter(o => o.type === 'failed_path')
      .map(o => o.content);

    const filesModified = observations
      .filter(o => o.type === 'file_change')
      .map(o => o.content);

    const openTasks = observations
      .filter(o => o.type === 'blocker' || o.type === 'progress')
      .map(o => o.content);

    // 从所有观察生成摘要
    const taskStarts = observations.filter(o => o.type === 'task_start');
    const insights = observations.filter(o => o.type === 'insight');
    const knowledgeApplied = observations.filter(o => o.type === 'knowledge_applied');
    const knowledgeRejected = observations.filter(o => o.type === 'knowledge_rejected');

    const summaryParts: string[] = [];
    if (taskStarts.length > 0) {
      summaryParts.push(`Worked on: ${taskStarts.map(t => t.content).join('; ')}.`);
    }
    if (problemsSolved.length > 0) {
      summaryParts.push(`Solved ${problemsSolved.length} problem(s).`);
    }
    if (failedPaths.length > 0) {
      summaryParts.push(`${failedPaths.length} approach(es) tried but abandoned.`);
    }
    if (decisions.length > 0) {
      summaryParts.push(`Made ${decisions.length} decision(s).`);
    }
    if (insights.length > 0) {
      summaryParts.push(`Key insights: ${insights.map(i => i.content).join('; ')}.`);
    }
    if (knowledgeApplied.length > 0) {
      summaryParts.push(`Applied ${knowledgeApplied.length} knowledge entries.`);
    }
    if (knowledgeRejected.length > 0) {
      summaryParts.push(`Rejected ${knowledgeRejected.length} knowledge entries.`);
    }
    if (openTasks.length > 0) {
      summaryParts.push(`${openTasks.length} task(s) still in progress.`);
    }

    return {
      sessionId: session.id,
      summary: summaryParts.join(' ') || 'Session with no significant observations recorded.',
      decisions,
      openTasks,
      problemsSolved: [...problemsSolved, ...failedPaths.map(f => `[FAILED APPROACH] ${f}`)],
      filesModified,
    };
  }
}
