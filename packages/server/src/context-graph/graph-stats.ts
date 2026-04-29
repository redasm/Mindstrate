import type { ContextNode } from '@mindstrate/protocol/models';
import { getStringMetadata } from './context-node-metadata.js';

/**
 * Aggregate graph nodes into counts by domain type, status, and language.
 * Used by maintenance.getStats and similar diagnostic surfaces.
 */
export const getGraphStats = (nodes: ContextNode[]): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byLanguage: Record<string, number>;
} => {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const node of nodes) {
    byType[node.domainType] = (byType[node.domainType] ?? 0) + 1;
    byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
    const language = getStringMetadata(node, 'context', 'language');
    if (language) {
      byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    }
  }

  return {
    total: nodes.length,
    byType,
    byStatus,
    byLanguage,
  };
};
