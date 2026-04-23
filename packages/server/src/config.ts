/**
 * Mindstrate - Configuration
 *
 * Global configuration with environment variable overrides and sensible defaults.
 */

import * as path from 'node:path';
import * as os from 'node:os';

export interface MindstrateConfig {
  /** 数据存储目录 */
  dataDir: string;

  /** SQLite 数据库文件路径 */
  dbPath: string;

  /** 向量存储目录 */
  vectorStorePath: string;

  /** OpenAI API Key (or any provider that speaks the OpenAI API) */
  openaiApiKey: string;

  /**
   * Optional base URL for the LLM endpoint.
   *
   * Defaults to OpenAI's official API. Set this to use any
   * OpenAI-compatible provider, e.g.:
   *   - Aliyun:   https://dashscope.aliyuncs.com/compatible-mode/v1
   *   - DeepSeek: https://api.deepseek.com/v1
   *   - Moonshot: https://api.moonshot.cn/v1
   *   - Local:    http://127.0.0.1:11434/v1   (Ollama)
   */
  openaiBaseUrl?: string;

  /**
   * Optional separate base URL for embeddings.
   *
   * Useful when you want, say, Aliyun for chat (cheap) but OpenAI's
   * `text-embedding-3-small` for embeddings (high quality). When unset,
   * embeddings reuse `openaiBaseUrl` (or default if neither is set).
   */
  openaiEmbeddingBaseUrl?: string;

  /** Embedding 模型 */
  embeddingModel: string;

  /** Chat / completion 模型（用于 LLM 抽取、Session 压缩、知识进化） */
  llmModel: string;

  /** 向量 collection 名称 */
  collectionName: string;

  /** 检索默认返回数量 */
  defaultTopK: number;

  /** 去重相似度阈值 */
  deduplicationThreshold: number;

  /** Obsidian vault 路径（设置后自动启用 vault 同步） */
  obsidianVaultPath?: string;

  /** 是否在 add/update/delete 后自动写入 vault（默认 true，需先配置 obsidianVaultPath） */
  obsidianAutoSync?: boolean;
}

/** 默认数据目录：用户 home 下的 .mindstrate */
function getDefaultDataDir(): string {
  return path.join(os.homedir(), '.mindstrate');
}

/** 加载配置，优先使用环境变量 */
export function loadConfig(overrides?: Partial<MindstrateConfig>): MindstrateConfig {
  const dataDir = overrides?.dataDir
    ?? process.env['MINDSTRATE_DATA_DIR']
    ?? getDefaultDataDir();

  return {
    dataDir,
    dbPath: overrides?.dbPath
      ?? process.env['MINDSTRATE_DB_PATH']
      ?? path.join(dataDir, 'mindstrate.db'),
    vectorStorePath: overrides?.vectorStorePath
      ?? process.env['MINDSTRATE_VECTOR_PATH']
      ?? path.join(dataDir, 'vectors'),
    openaiApiKey: overrides?.openaiApiKey
      ?? process.env['OPENAI_API_KEY']
      ?? '',
    openaiBaseUrl: overrides?.openaiBaseUrl
      ?? process.env['OPENAI_BASE_URL']
      ?? undefined,
    openaiEmbeddingBaseUrl: overrides?.openaiEmbeddingBaseUrl
      ?? process.env['OPENAI_EMBEDDING_BASE_URL']
      ?? undefined,
    embeddingModel: overrides?.embeddingModel
      ?? process.env['MINDSTRATE_EMBEDDING_MODEL']
      ?? 'text-embedding-3-small',
    llmModel: overrides?.llmModel
      ?? process.env['MINDSTRATE_LLM_MODEL']
      ?? 'gpt-4o-mini',
    collectionName: overrides?.collectionName ?? 'mindstrate',
    defaultTopK: overrides?.defaultTopK ?? 5,
    deduplicationThreshold: overrides?.deduplicationThreshold ?? 0.92,
    obsidianVaultPath: overrides?.obsidianVaultPath
      ?? process.env['OBSIDIAN_VAULT_PATH']
      ?? undefined,
    obsidianAutoSync: overrides?.obsidianAutoSync
      ?? (process.env['OBSIDIAN_AUTO_SYNC']
        ? process.env['OBSIDIAN_AUTO_SYNC'] !== 'false'
        : true),
  };
}
