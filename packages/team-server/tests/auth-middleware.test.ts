import { describe, expect, it } from 'vitest';
import { safeCompare } from '../src/http/auth-middleware.js';

describe('safeCompare', () => {
  it('returns true for identical strings', () => {
    expect(safeCompare('shared-secret', 'shared-secret')).toBe(true);
    expect(safeCompare('', '')).toBe(true);
  });

  it('returns false for same-length but different content', () => {
    expect(safeCompare('abcdef', 'abcdeg')).toBe(false);
  });

  it('returns false for different-length inputs without throwing', () => {
    expect(() => safeCompare('short', 'considerably-longer-token')).not.toThrow();
    expect(safeCompare('short', 'considerably-longer-token')).toBe(false);
    expect(safeCompare('considerably-longer-token', 'short')).toBe(false);
  });

  it('handles empty vs non-empty without throwing', () => {
    expect(safeCompare('', 'something')).toBe(false);
    expect(safeCompare('something', '')).toBe(false);
  });

  it('treats unicode payloads as opaque bytes', () => {
    expect(safeCompare('密钥-α', '密钥-α')).toBe(true);
    expect(safeCompare('密钥-α', '密钥-β')).toBe(false);
  });
});
