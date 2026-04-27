import type { GraphKnowledgeSearchResult } from '@mindstrate/protocol';
import type { McpToolResponse } from '../types.js';

export function formatGraphKnowledgeResults(
  results: GraphKnowledgeSearchResult[],
  messages: {
    empty: string;
    found: (count: number) => string;
  },
): McpToolResponse {
  if (results.length === 0) {
    return { content: [{ type: 'text', text: messages.empty }] };
  }

  const formatted = results.map((result, index) => {
    const view = result.view;
    return [
      `### ${index + 1}. [${view.substrateType}] ${view.title}`,
      `Relevance: ${(result.relevanceScore * 100).toFixed(1)}% | Priority: ${view.priorityScore.toFixed(2)}`,
      `Domain: ${view.domainType}`,
      `Summary: ${view.summary}`,
      view.tags.length > 0 ? `Tags: ${view.tags.join(', ')}` : null,
      `ID: ${view.id}`,
    ].filter(Boolean).join('\n');
  }).join('\n---\n\n');

  return {
    content: [{
      type: 'text',
      text: `${messages.found(results.length)}:\n\n${formatted}`,
    }],
  };
}
