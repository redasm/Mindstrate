import { describe, expect, it } from 'vitest';
import { supportsCustomDimensions } from '../src/processing/provider-factory.js';

describe('supportsCustomDimensions', () => {
  it('returns true for models with adjustable output dimensions', () => {
    expect(supportsCustomDimensions('text-embedding-v4')).toBe(true);
    expect(supportsCustomDimensions('text-embedding-v3')).toBe(true);
    expect(supportsCustomDimensions('text-embedding-3-small')).toBe(true);
    expect(supportsCustomDimensions('text-embedding-3-large')).toBe(true);
  });

  it('returns false for fixed-dimension models (they reject the param)', () => {
    expect(supportsCustomDimensions('text-embedding-v2')).toBe(false);
    expect(supportsCustomDimensions('text-embedding-v1')).toBe(false);
    expect(supportsCustomDimensions('text-embedding-ada-002')).toBe(false);
    expect(supportsCustomDimensions('some-unknown-model')).toBe(false);
  });
});
