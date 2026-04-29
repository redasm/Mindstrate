/**
 * Graph-knowledge view lookup by full or prefix ID. Used by commands that
 * accept either a full UUID or a short prefix to resolve a target view.
 */

import { Mindstrate, type GraphKnowledgeView } from '@mindstrate/server';

export function findGraphKnowledge(
  memory: Mindstrate,
  idOrPrefix: string,
): GraphKnowledgeView | null {
  const entries = memory.context.readGraphKnowledge({ limit: 100000 });
  return entries.find((entry) => entry.id === idOrPrefix || entry.id.startsWith(idOrPrefix)) ?? null;
}
