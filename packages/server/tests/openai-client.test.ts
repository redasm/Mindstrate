/**
 * Tests for the OpenAI client factory.
 *
 * The factory exists so that all consumers (embedder, session-compressor,
 * evolution, extractor) share a single instance of the OpenAI SDK and
 * pick up baseURL overrides consistently. Test the contract here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getOpenAIClient, clearOpenAIClientCache } from '../src/openai-client.js';

describe('getOpenAIClient', () => {
  beforeEach(() => {
    clearOpenAIClientCache();
  });

  it('returns null when apiKey is empty', async () => {
    expect(await getOpenAIClient('')).toBeNull();
    expect(await getOpenAIClient('', 'https://example.com/v1')).toBeNull();
  });

  it('caches the client when called twice with the same key+baseURL', async () => {
    const a = await getOpenAIClient('test-key');
    const b = await getOpenAIClient('test-key');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('caches independently when baseURL differs', async () => {
    // Same apiKey, different baseURL -> different clients (this is the
    // crucial behaviour: a user mixing OpenAI for embeddings and Aliyun
    // for chat must get different SDK instances even if both happen to
    // use the same API key by accident.)
    const openai = await getOpenAIClient('shared-key');
    const aliyun = await getOpenAIClient('shared-key', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    const deepseek = await getOpenAIClient('shared-key', 'https://api.deepseek.com/v1');

    expect(openai).not.toBeNull();
    expect(aliyun).not.toBeNull();
    expect(deepseek).not.toBeNull();
    expect(openai).not.toBe(aliyun);
    expect(aliyun).not.toBe(deepseek);
    expect(openai).not.toBe(deepseek);

    // But within the same baseURL, repeated calls reuse the cached client
    const aliyun2 = await getOpenAIClient('shared-key', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(aliyun).toBe(aliyun2);
  });

  it('caches independently when apiKey differs (with same baseURL)', async () => {
    const a = await getOpenAIClient('key-a', 'https://api.deepseek.com/v1');
    const b = await getOpenAIClient('key-b', 'https://api.deepseek.com/v1');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('clearOpenAIClientCache forces a fresh client on next call', async () => {
    const a = await getOpenAIClient('test-key');
    clearOpenAIClientCache();
    const b = await getOpenAIClient('test-key');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it('returned client exposes embeddings and chat.completions', async () => {
    const c = await getOpenAIClient('test-key');
    expect(c).not.toBeNull();
    expect(typeof c!.embeddings.create).toBe('function');
    expect(typeof c!.chat.completions.create).toBe('function');
  });
});
