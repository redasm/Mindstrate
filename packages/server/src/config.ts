/**
 * Mindstrate - Configuration
 *
 * Global configuration with environment variable overrides and sensible defaults.
 *
 * Note: LLM/embedding provider settings are no longer environment variables.
 * They are configured per-project via the Settings UI (/settings/llm-configs)
 * and stored in the `project_llm_configs` table.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import type { Logger } from './runtime/logger.js';

export interface MindstrateConfig {
  /** 数据存储目录 */
  dataDir: string;

  /** SQLite 数据库文件路径 */
  dbPath: string;

  /** 向量存储目录 */
  vectorStorePath: string;

  /** Vector backend: local JSON or Qdrant */
  vectorBackend: 'local' | 'qdrant';

  /** Qdrant REST endpoint when vectorBackend=qdrant */
  qdrantUrl?: string;

  /** Optional Qdrant API key */
  qdrantApiKey?: string;

  /** 向量 collection 名称前缀（实际 collection 为 `<collectionName>-<projectSlug>`） */
  collectionName: string;

  /** 检索默认返回数量 */
  defaultTopK: number;

  /** 去重相似度阈值 */
  deduplicationThreshold: number;

  /** Obsidian vault 路径（设置后自动启用 vault 同步） */
  obsidianVaultPath?: string;

  /** 是否在 add/update/delete 后自动写入 vault（默认 true，需先配置 obsidianVaultPath） */
  obsidianAutoSync?: boolean;

  /**
   * Project graph LLM 调用节流策略。
   *
   * - `factBatchSize`: 每次发送给 LLM 的 extracted-fact 数量上限。
   * - `requestDelayMs`: 相邻 LLM 请求之间的最小间隔（全 process 队列），用于规避
   *   provider 的 TPS/TPM 配额（如 DashScope AllocationQuota）。
   * - `requestTimeoutMs`: 单次 project graph LLM 请求超时。
   *
   * 留空时使用内置默认值（batch=20，delay=1500ms，timeout=60000ms）。
   */
  projectGraphLlm: {
    factBatchSize: number;
    requestDelayMs: number;
    requestTimeoutMs: number;
  };

  /**
   * Optional logger for runtime warnings/errors. Library code never writes
   * to stdio directly; when omitted, diagnostics are silently dropped
   * (`noopLogger`). CLI / web-ui / team-server install a console logger;
   * mcp-server keeps the noop default to protect the JSON-RPC stream.
   */
  logger?: Logger;
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
    vectorBackend: overrides?.vectorBackend
      ?? (process.env['MINDSTRATE_VECTOR_BACKEND'] === 'qdrant' ? 'qdrant' : 'local'),
    qdrantUrl: overrides?.qdrantUrl
      ?? process.env['MINDSTRATE_QDRANT_URL']
      ?? undefined,
    qdrantApiKey: overrides?.qdrantApiKey
      ?? process.env['MINDSTRATE_QDRANT_API_KEY']
      ?? undefined,
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
    projectGraphLlm: {
      factBatchSize: overrides?.projectGraphLlm?.factBatchSize
        ?? positiveIntegerEnv(process.env['MINDSTRATE_PROJECT_GRAPH_LLM_FACT_BATCH_SIZE'])
        ?? 20,
      requestDelayMs: overrides?.projectGraphLlm?.requestDelayMs
        ?? nonNegativeIntegerEnv(process.env['MINDSTRATE_PROJECT_GRAPH_LLM_DELAY_MS'])
        ?? 1500,
      requestTimeoutMs: overrides?.projectGraphLlm?.requestTimeoutMs
        ?? positiveIntegerEnv(process.env['MINDSTRATE_PROJECT_GRAPH_LLM_TIMEOUT_MS'])
        ?? 60000,
    },
    logger: overrides?.logger,
  };
}

function positiveIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeIntegerEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
