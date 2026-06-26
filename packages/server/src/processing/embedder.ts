/**
 * Mindstrate - Embedding Generator
 *
 * 支持两种模式：
 * 1. OpenAI API（生产模式，高精度）
 * 2. 本地 hash-based embedding（离线模式，无需 API key）
 *
 * 离线模式使用简易的词频向量，精度较低但完全免费、零延迟。
 * 是否使用 OpenAI 由项目级 LLM Config 决定（Web UI Settings → LLM Configs），
 * 不再依赖进程级 OPENAI_API_KEY 环境变量；ProviderFactory 会按项目装配
 * 对应的 Embedder 实例。
 */

import type { CreateKnowledgeInput } from '@mindstrate/protocol';
import { EmbeddingError } from '@mindstrate/protocol';
import { getOpenAIClient, type OpenAIClient } from '../openai-client.js';

/** Embedding 维度（离线模式） */
const LOCAL_EMBEDDING_DIM = 256;

/** Embedding 维度（OpenAI text-embedding-3-small） */
const OPENAI_EMBEDDING_DIM = 1536;

/**
 * Max inputs per embedding API request. Aliyun DashScope's OpenAI-compatible
 * endpoint rejects batches larger than 10 (`batch size is invalid, it should
 * not be larger than 10`); OpenAI itself allows up to 2048. Default to the
 * safe DashScope limit so the common Aliyun setup works out of the box, and
 * let users on OpenAI raise it via `MINDSTRATE_EMBEDDING_MAX_BATCH`. The
 * embedder chunks any larger batch into requests of at most this size.
 */
const DEFAULT_EMBEDDING_MAX_BATCH = 10;

const EMBEDDING_MAX_BATCH = ((): number => {
  const raw = process.env['MINDSTRATE_EMBEDDING_MAX_BATCH'];
  if (raw === undefined) return DEFAULT_EMBEDDING_MAX_BATCH;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_EMBEDDING_MAX_BATCH;
  return parsed;
})();

export interface EmbedderMetrics {
  apiCalls: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface EmbedderOptions {
  client?: OpenAIClient;
  maxConcurrentRequests?: number;
}

export class Embedder {
  private apiKey: string;
  private baseURL?: string;
  private model: string;
  private useLocal: boolean;
  private client?: OpenAIClient;
  private cache = new Map<string, number[]>();
  private pending = new Map<string, Promise<number[]>>();
  private metrics: EmbedderMetrics = { apiCalls: 0, cacheHits: 0, cacheMisses: 0 };
  private activeRequests = 0;
  private waiters: Array<() => void> = [];
  private maxConcurrentRequests: number;

  constructor(
    apiKey: string,
    model: string = 'text-embedding-3-small',
    baseURL?: string,
    options: EmbedderOptions = {},
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.useLocal = !apiKey;
    this.client = options.client;
    this.maxConcurrentRequests = Math.max(options.maxConcurrentRequests ?? 2, 1);
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

  getMetrics(): EmbedderMetrics {
    return { ...this.metrics };
  }

  // ========================================
  // OpenAI API
  // ========================================

  private async getClient(): Promise<OpenAIClient> {
    if (this.client) return this.client;
    const client = await getOpenAIClient(this.apiKey, this.baseURL);
    if (!client) {
      throw new EmbeddingError('OpenAI client unavailable. Ensure openai package is installed and API key is valid.', {});
    }
    return client;
  }

  private async openaiEmbed(text: string): Promise<number[]> {
    const key = this.cacheKey(text);
    const cached = this.cache.get(key);
    if (cached) {
      this.metrics.cacheHits++;
      return cached;
    }

    const pending = this.pending.get(key);
    if (pending) {
      this.metrics.cacheHits++;
      return pending;
    }

    this.metrics.cacheMisses++;
    const request = this.withApiSlot(async () => {
      const client = await this.getClient();
      this.metrics.apiCalls++;
      const response = await client.embeddings.create({
        model: this.model,
        input: text,
      });
      const embedding = response.data[0].embedding;
      this.cache.set(key, embedding);
      return embedding;
    }).finally(() => {
      this.pending.delete(key);
    });
    this.pending.set(key, request);

    try {
      return await request;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        `OpenAI embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        { model: this.model, textLength: text.length },
      );
    }
  }

  private async openaiEmbedBatch(texts: string[]): Promise<number[][]> {
    const results = new Map<string, number[]>();
    const missing: string[] = [];
    const seenMissing = new Set<string>();

    for (const text of texts) {
      const key = this.cacheKey(text);
      const cached = this.cache.get(key);
      if (cached) {
        this.metrics.cacheHits++;
        results.set(text, cached);
      } else if (!seenMissing.has(text)) {
        this.metrics.cacheMisses++;
        seenMissing.add(text);
        missing.push(text);
      }
    }

    if (missing.length === 0) {
      return texts.map((text) => results.get(text)!);
    }

    try {
      // Chunk into requests of at most EMBEDDING_MAX_BATCH inputs: providers
      // like Aliyun DashScope hard-cap batch size at 10, so a single large
      // request (e.g. the 64-wide node-embedding backfill) would 400.
      for (let start = 0; start < missing.length; start += EMBEDDING_MAX_BATCH) {
        const chunk = missing.slice(start, start + EMBEDDING_MAX_BATCH);
        const response = await this.withApiSlot(async () => {
          const client = await this.getClient();
          this.metrics.apiCalls++;
          return client.embeddings.create({
            model: this.model,
            input: chunk,
          });
        });

        const embeddings = response.data
          .sort((a, b) => a.index - b.index)
          .map(d => d.embedding);
        for (let i = 0; i < chunk.length; i++) {
          const text = chunk[i];
          const embedding = embeddings[i];
          this.cache.set(this.cacheKey(text), embedding);
          results.set(text, embedding);
        }
      }
      return texts.map((text) => results.get(text)!);
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError(
        `OpenAI batch embedding failed: ${err instanceof Error ? err.message : String(err)}`,
        { model: this.model, batchSize: texts.length },
      );
    }
  }

  private cacheKey(text: string): string {
    return `${this.baseURL ?? '<default>'}::${this.model}::${text}`;
  }

  private async withApiSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrentRequests) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    this.activeRequests++;
    try {
      return await work();
    } finally {
      this.activeRequests--;
      this.waiters.shift()?.();
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

  // CJK 文本没有空格分词：若把整段连续中文当作单个 token，只有逐字
  // 完全相同的句段才会产生向量重叠，离线检索对中文基本失效。这里按
  // “拉丁/数字词 + 单个 CJK 字符”切分，下方的 bigram 循环会天然组合出
  // 字符二元组（近似中文双字词），使词汇级重叠可被捕捉。
  const tokens = text.toLowerCase().match(/[a-z0-9]+|[一-鿿]/g) ?? [];

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
