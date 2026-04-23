/**
 * Mindstrate - Shared Math Utilities
 *
 * Reusable math functions for vector operations and date calculations.
 */

/** Compute cosine similarity between two vectors (0 to 1) */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    if (typeof process !== 'undefined' && process.env['NODE_ENV'] !== 'production') {
      console.warn(
        `cosineSimilarity: dimension mismatch (${a.length} vs ${b.length}), returning 0. This indicates a bug.`
      );
    }
    return 0;
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

/** Calculate the number of days since a given ISO date string (always >= 0) */
export function daysSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
