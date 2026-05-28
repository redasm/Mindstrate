import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const ENV_KEYS = [
    'MINDSTRATE_PROJECT_GRAPH_LLM_FACT_BATCH_SIZE',
    'MINDSTRATE_PROJECT_GRAPH_LLM_DELAY_MS',
    'MINDSTRATE_PROJECT_GRAPH_LLM_TIMEOUT_MS',
    'MINDSTRATE_VECTOR_BACKEND',
    'MINDSTRATE_QDRANT_URL',
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

  it('defaults to local vector backend with sensible projectGraphLlm values', () => {
    const cfg = loadConfig();
    expect(cfg.vectorBackend).toBe('local');
    expect(cfg.collectionName).toBe('mindstrate');
    expect(cfg.projectGraphLlm).toEqual({
      factBatchSize: 20,
      requestDelayMs: 1500,
      requestTimeoutMs: 60000,
    });
  });

  it('reads MINDSTRATE_VECTOR_BACKEND=qdrant with its URL', () => {
    process.env['MINDSTRATE_VECTOR_BACKEND'] = 'qdrant';
    process.env['MINDSTRATE_QDRANT_URL'] = 'http://qdrant:6333';
    const cfg = loadConfig();
    expect(cfg.vectorBackend).toBe('qdrant');
    expect(cfg.qdrantUrl).toBe('http://qdrant:6333');
  });

  it('explicit overrides win over environment', () => {
    process.env['MINDSTRATE_VECTOR_BACKEND'] = 'qdrant';
    const cfg = loadConfig({ vectorBackend: 'local' });
    expect(cfg.vectorBackend).toBe('local');
  });

  it('reads project graph LLM throttling and timeout settings', () => {
    process.env['MINDSTRATE_PROJECT_GRAPH_LLM_FACT_BATCH_SIZE'] = '10';
    process.env['MINDSTRATE_PROJECT_GRAPH_LLM_DELAY_MS'] = '6000';
    process.env['MINDSTRATE_PROJECT_GRAPH_LLM_TIMEOUT_MS'] = '30000';

    const cfg = loadConfig();

    expect(cfg.projectGraphLlm).toEqual({
      factBatchSize: 10,
      requestDelayMs: 6000,
      requestTimeoutMs: 30000,
    });
  });
});
