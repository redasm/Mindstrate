import type { ContextNode } from '@mindstrate/protocol/models';

/**
 * Lexical + quality + confidence score for graph-node retrieval ranking.
 * Returns 0 when no query token matches, otherwise a weighted blend in [0, 1].
 */
export const computeGraphNodeMatchScore = (tokens: string[], node: ContextNode): number => {
  const haystack = `${node.title}\n${node.content}\n${node.tags.join(' ')}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;

  const lexicalScore = matched / tokens.length;
  const qualityScore = Math.min(node.qualityScore / 100, 1);
  const confidenceScore = Math.min(node.confidence, 1);
  return lexicalScore * 0.6 + qualityScore * 0.25 + confidenceScore * 0.15;
};
