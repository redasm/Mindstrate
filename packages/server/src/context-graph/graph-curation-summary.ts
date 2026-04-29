import type { GraphKnowledgeSearchResult } from '@mindstrate/protocol';

/**
 * Build a short human-readable summary of curated graph knowledge for a task.
 * Used by context-assembly to seed the "Task Curation" section.
 */
export const generateGraphCurationSummary = (
  task: string,
  knowledge: GraphKnowledgeSearchResult[],
  workflows: GraphKnowledgeSearchResult[],
  warnings: GraphKnowledgeSearchResult[],
): string => {
  const parts: string[] = [`Curated graph context for: ${task}`];
  if (knowledge.length > 0) {
    parts.push(`Relevant graph knowledge: ${knowledge.map((result) => result.view.title).join(', ')}`);
  }
  if (workflows.length > 0) {
    parts.push(`Applicable workflows: ${workflows.map((result) => result.view.title).join(', ')}`);
  }
  if (warnings.length > 0) {
    parts.push(`Potential pitfalls: ${warnings.map((result) => result.view.title).join(', ')}`);
  }
  if (parts.length === 1) {
    parts.push('No directly matching graph knowledge found. Use project/session substrate and proceed carefully.');
  }
  return parts.join('\n');
};
