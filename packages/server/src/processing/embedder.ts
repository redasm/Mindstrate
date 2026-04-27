/**
 * Mindstrate - Embedding Generator
 *
 * 支持两种模式：
 * 1. OpenAI API（生产模式，高精度）
 * 2. 本地 hash-based embedding（离线模式，无需 API key）
 *
 * 离线模式使用简易的词频向量，精度较低但完全免费、零延迟。
 * 设置 OPENAI_API_KEY 后自动切换到 OpenAI 模式。
 */

import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import { EmbeddingError } from '@mindstrate/protocol';
import { getOpenAIClient, type OpenAIClient } from '../openai-client.js';

/** Embedding 维度（离线模式） */
const LOCAL_EMBEDDING_DIM = 256;

/** Embedding 维度（OpenAI text-embedding-3-small） */
const OPENAI_EMBEDDING_DIM = 1536;

export class Embedder {
  private apiKey: string;
  private baseURL?: string;
  private model: string;
  private useLocal: boolean;

  constructor(apiKey: string, model: string = 'text-embedding-3-small', baseURL?: string) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.useLocal = !apiKey;
  }

  /** 获取当前模式的 embedding 维度 */
  getEmbeddingDimension(): number {
    return this.useLocal ? LOCAL_EMBEDDING_DIM : OPENAI_EMBEDDING_DIM;
  }

  /**
   * 将图写入输入转换为用于 embedding 的文本。
   * 拼接策略：title + problem + solution + tags
   */
  knowledgeToText(knowledge: CreateKnowledgeInput): string {
    const parts: string[] = [];

    parts.push(`[${knowledge.type}] ${knowledge.title}`);

    if (knowledge.problem) {
      parts.push(`Problem: ${knowledge.problem}`);
    }

    parts.push(`Solution: ${knowledge.solution}`);

    const tags = knowledge.tags ?? [];
    if (tags.length > 0) {
      parts.push(`Tags: ${tags.join(', ')}`);
    }

    // 包含上下文信息
    const ctx = knowledge.context;
    if (ctx) {
      if (ctx.language) parts.push(`Language: ${ctx.language}`);
      if (ctx.framework) parts.push(`Framework: ${ctx.framework}`);
    }

    return parts.join('\n');
  }

  /** 生成单条文本的 embedding */
  async embed(text: string): Promise<number[]> {
    if (this.useLocal) {
      return localEmbed(text);
    }
    return this.openaiEmbed(text);
  }

  /** 批量生成 embedding */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (this.useLocal) {
      return texts.map(t => localEmbed(t));
    }
    return this.openaiEmbedBatch(texts);
  }

  /** 为图写入输入生成 embedding */
  async embedKnowledge(knowledge: CreateKnowledgeInput): Promise<number[]> {
    const text = this.knowledgeToText(knowledge);
    return this.embed(text);
  }

  /** 是否使用本地模式 */
  isLocalMode(): boolean {
    return this.useLocal;
  }

  // ========================================
  // OpenAI API
  // ========================================

  private async getClient(): Promise<OpenAIClient> {
    const client = await getOpenAIClient(this.apiKey, this.baseURL);
    if (!client) {
      throw new EmbeddingError('OpenAI client unavailable. Ensure openai package is installed and API key is valid.', {});
    }
    return client;
  }

  private async openaiEmbed(text: string): Promise<number[]> {
    try {
      const client = await this.getClient();
      const response = await client.embeddings.create({
        model: this.model,
        input: text,
      });
      return response.data[0].embedding;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        `OpenAI embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        { model: this.model, textLength: text.length },
      );
    }
  }

  private async openaiEmbedBatch(texts: string[]): Promise<number[][]> {
    try {
      const client = await this.getClient();
      const response = await client.embeddings.create({
        model: this.model,
        input: texts,
      });
      return response.data
        .sort((a, b) => a.index - b.index)
        .map(d => d.embedding);
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        `OpenAI batch embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        { model: this.model, batchSize: texts.length },
      );
    }
  }
}

// ============================================================
// Local embedding (hash-based, for offline/MVP use)
// ============================================================

/**
 * 简易本地 embedding：
 * 1. 分词 → 2. 对每个词计算 hash → 3. 累加到固定维度向量 → 4. L2 归一化
 *
 * 这不是真正的语义理解，但能捕捉词汇重叠，
 * 对于 MVP 验证和离线场景足够用。
 */
function localEmbed(text: string): number[] {
  const vec = new Float64Array(LOCAL_EMBEDDING_DIM);

  // 简单分词：按非字母数字字符分割，转小写
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(t => t.length > 0);

  // 同时处理 bigram 以捕获短语信息
  const allTokens = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    allTokens.push(`${tokens[i]}_${tokens[i + 1]}`);
  }

  for (const token of allTokens) {
    const hash = simpleHash(token);
    if (hash === 0) continue; // 避免零值 hash 造成的方向偏差
    const idx = Math.abs(hash) % LOCAL_EMBEDDING_DIM;
    const sign = hash > 0 ? 1 : -1;
    vec[idx] += sign;

    // 二次 hash 增加稀疏性
    const hash2 = simpleHash(token + '_2');
    if (hash2 === 0) continue;
    const idx2 = Math.abs(hash2) % LOCAL_EMBEDDING_DIM;
    vec[idx2] += (hash2 > 0 ? 1 : -1) * 0.5;
  }

  // L2 归一化
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

/** 简单的字符串哈希函数 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash | 0; // 转 32 位整数
  }
  return hash;
}
