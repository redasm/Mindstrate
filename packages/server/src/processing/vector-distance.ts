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
