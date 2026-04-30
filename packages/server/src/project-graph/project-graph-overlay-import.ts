import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectGraphOverlaySource,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import {
  createProjectGraphOverlay,
  listProjectGraphOverlays,
  parseProjectGraphOverlayBlock,
} from './overlay.js';

export const importProjectGraphOverlayBlock = (
  store: ContextGraphStore,
  project: string,
  text: string,
): void => {
  const parsed = parseProjectGraphOverlayBlock(text);
  if (parsed.length === 0) return;
  const existing = listProjectGraphOverlays(store, { project, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  for (const overlay of parsed) {
    const alreadyStored = existing.some((entry) =>
      entry.kind === overlay.kind
      && entry.content === overlay.content
      && entry.target === overlay.target
      && entry.targetNodeId === overlay.targetNodeId
      && entry.targetEdgeId === overlay.targetEdgeId);
    if (alreadyStored) continue;
    createProjectGraphOverlay(store, {
      project,
      target: overlay.target,
      targetNodeId: overlay.targetNodeId,
      targetEdgeId: overlay.targetEdgeId,
      kind: overlay.kind,
      content: overlay.content,
      source: ProjectGraphOverlaySource.OBSIDIAN,
    });
  }
};
