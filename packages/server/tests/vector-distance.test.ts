import { describe, expect, it } from 'vitest';
import { cosineSimilarity, dotProduct, l2Normalize } from '../src/processing/vector-distance.js';

describe('vector-distance', () => {
  it('dotProduct of two normalized vectors equals their cosine', () => {
    const a = [0.4, 0.1, 0.9, -0.3];
    const b = [-0.2, 0.7, 0.5, 0.1];
    const cos = cosineSimilarity(a, b);
    const dot = dotProduct(l2Normalize(a), l2Normalize(b));
    expect(dot).toBeCloseTo(cos, 10);
  });

  it('l2Normalize returns a unit vector', () => {
    const n = l2Normalize([3, 4]); // magnitude 5
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
    expect(n[0]).toBeCloseTo(0.6, 12);
    expect(n[1]).toBeCloseTo(0.8, 12);
  });

  it('l2Normalize leaves a zero vector unchanged (no NaN)', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('dotProduct throws on dimension mismatch rather than silently returning 0', () => {
    expect(() => dotProduct([1, 2], [1, 2, 3])).toThrow(/dimension mismatch/);
  });

  it('dotProduct accepts a Float32Array operand (the BLOB read path)', () => {
    const q = l2Normalize([1, 0, 0]);
    const candidate = Float32Array.from(l2Normalize([1, 0, 0]));
    expect(dotProduct(q, candidate)).toBeCloseTo(1, 6);
  });
});
