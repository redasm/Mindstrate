import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveContentLocale, contentLanguageInstruction } from '../src/content-locale.js';
import { buildExtractionSystemPrompt } from '../src/prompts.js';

describe('content locale', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      MINDSTRATE_LOCALE: process.env['MINDSTRATE_LOCALE'],
      LC_ALL: process.env['LC_ALL'],
      LC_MESSAGES: process.env['LC_MESSAGES'],
      LANG: process.env['LANG'],
    };
    delete process.env['LC_ALL'];
    delete process.env['LC_MESSAGES'];
    delete process.env['LANG'];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves zh from MINDSTRATE_LOCALE=zh-CN', () => {
    process.env['MINDSTRATE_LOCALE'] = 'zh-CN';
    expect(resolveContentLocale()).toBe('zh');
    expect(contentLanguageInstruction()).toContain('Simplified Chinese');
  });

  it('resolves en when locale is not Chinese', () => {
    process.env['MINDSTRATE_LOCALE'] = 'en-US';
    expect(resolveContentLocale()).toBe('en');
    expect(contentLanguageInstruction()).toContain('English');
  });

  it('injects the resolved language instruction into the extraction prompt, overriding source language', () => {
    process.env['MINDSTRATE_LOCALE'] = 'zh-CN';
    const prompt = buildExtractionSystemPrompt(contentLanguageInstruction());
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).toContain('regardless of the language of the source commit');
    // The base extraction guidance is still present.
    expect(prompt).toContain('reusable engineering knowledge');
  });
});
