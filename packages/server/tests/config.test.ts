/**
 * Tests for config loading — focused on the OpenAI-compatible provider
 * configuration that lets users point Mindstrate at Aliyun, DeepSeek,
 * Moonshot, local Ollama, etc.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig — OpenAI-compatible provider settings', () => {
  const ENV_KEYS = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_EMBEDDING_BASE_URL',
    'MINDSTRATE_EMBEDDING_MODEL',
    'MINDSTRATE_LLM_MODEL',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults: no baseURL, OpenAI official endpoint', () => {
    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBeUndefined();
    expect(cfg.openaiEmbeddingBaseUrl).toBeUndefined();
    expect(cfg.embeddingModel).toBe('text-embedding-3-small');
    expect(cfg.llmModel).toBe('gpt-4o-mini');
  });

  it('reads OPENAI_BASE_URL from environment (Aliyun example)', () => {
    process.env['OPENAI_BASE_URL'] = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    process.env['OPENAI_API_KEY'] = 'sk-aliyun-test';
    process.env['MINDSTRATE_LLM_MODEL'] = 'qwen-max';
    process.env['MINDSTRATE_EMBEDDING_MODEL'] = 'text-embedding-v3';

    const cfg = loadConfig();
    expect(cfg.openaiApiKey).toBe('sk-aliyun-test');
    expect(cfg.openaiBaseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(cfg.llmModel).toBe('qwen-max');
    expect(cfg.embeddingModel).toBe('text-embedding-v3');
  });

  it('OPENAI_EMBEDDING_BASE_URL is independent (mixed-provider scenario)', () => {
    // Use Aliyun for chat (cheap), but OpenAI for embeddings (high quality).
    process.env['OPENAI_BASE_URL'] = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    process.env['OPENAI_EMBEDDING_BASE_URL'] = 'https://api.openai.com/v1';

    const cfg = loadConfig();
    expect(cfg.openaiBaseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(cfg.openaiEmbeddingBaseUrl).toBe('https://api.openai.com/v1');
  });

  it('explicit overrides win over environment', () => {
    process.env['OPENAI_BASE_URL'] = 'https://from-env';
    const cfg = loadConfig({ openaiBaseUrl: 'https://from-override' });
    expect(cfg.openaiBaseUrl).toBe('https://from-override');
  });

  it('unset env => undefined fields (so OpenAI SDK falls back to its default)', () => {
    const cfg = loadConfig();
    expect('openaiBaseUrl' in cfg).toBe(true);
    expect(cfg.openaiBaseUrl).toBeUndefined();
  });
});
