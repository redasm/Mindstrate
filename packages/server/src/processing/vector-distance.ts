/**
 * Vector distance and similarity primitives for embedding-based retrieval.
 *
 * Lives next to `processing/embedder.ts` because every consumer here
 * compares vectors produced by that embedder.
 */

/**
 * Cosine similarity between two same-length number vectors, in [0, 1].
 *
 * Throws when dimensions differ — silently returning 0 has historically
 * masked embedding/model mismatches and produced confusing retrieval
 * regressions. Callers must compare vectors of the same dimensionality.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length}). `
      + 'This usually means two embeddings came from different models or were '
      + 'serialized at different schema versions; align dimensions before comparing.',
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Dot product of two same-length vectors. When both operands are L2-normalized
 * this equals their cosine similarity, but skips the two `sqrt`/norm passes
 * `cosineSimilarity` does — the hot path for a similarity scan over thousands
 * of stored embeddings that were normalized once at write time.
 *
 * Throws on dimension mismatch for the same reason `cosineSimilarity` does:
 * a silent 0 masks embedding/model drift.
 */
export function dotProduct(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(
      `dotProduct: dimension mismatch (${a.length} vs ${b.length}). `
      + 'This usually means two embeddings came from different models or were '
      + 'serialized at different schema versions; align dimensions before comparing.',
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Return an L2-normalized copy of `vec` (unit length). A zero vector is
 * returned unchanged — there is no meaningful direction to normalize to.
 * Normalizing at write time lets similarity scans use {@link dotProduct}.
 */
export function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}
