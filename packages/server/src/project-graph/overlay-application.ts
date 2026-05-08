import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphOverlayKind,
  type ContextNode,
  type ProjectGraphArtifactNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';

export interface ProjectGraphOverlayProjection {
  displayLabel: string;
  correction?: string;
}

export const projectGraphOverlayProjectionForNode = (
  node: ContextNode | ProjectGraphArtifactNode,
  overlays: ProjectGraphOverlay[],
): ProjectGraphOverlayProjection => {
  const label = 'title' in node ? node.title : node.label;
  const correction = overlays.find((overlay) =>
    overlay.kind === ProjectGraphOverlayKind.CORRECTION && overlayTargetsNode(overlay, node));
  return {
    displayLabel: labelFromCorrection(correction?.content) ?? label,
    correction: correction?.content,
  };
};

const labelFromCorrection = (content: string | undefined): string | undefined => {
  const match = content?.match(/^label\s*:\s*(.+)$/i);
  return match?.[1]?.trim();
};

const overlayTargetsNode = (
  overlay: ProjectGraphOverlay,
  node: ContextNode | ProjectGraphArtifactNode,
): boolean => {
  if (overlay.targetNodeId === node.id) return true;
  if (!overlay.target) return false;
  if (overlay.target === `node:${node.id}`) return true;
  const path = primaryPath(node);
  if (overlay.target.startsWith('path:') && path) return sameOrParentPath(overlay.target.slice('path:'.length), path);
  const label = 'title' in node ? node.title : node.label;
  return overlay.target.startsWith('symbol:') && overlay.target.slice('symbol:'.length) === label;
};

const primaryPath = (node: ContextNode | ProjectGraphArtifactNode): string | undefined => {
  if ('path' in node && node.path) return normalizePath(node.path);
  if ('sourceRef' in node && node.sourceRef) return normalizePath(node.sourceRef);
  const metadata = node.metadata ?? {};
  const ownedByFile = metadata[PROJECT_GRAPH_METADATA_KEYS.ownedByFile];
  if (typeof ownedByFile === 'string') return normalizePath(ownedByFile);
  const evidence = metadata[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (!Array.isArray(evidence)) return undefined;
  const first = evidence.find((entry) => entry && typeof entry === 'object' && 'path' in entry) as Record<string, unknown> | undefined;
  return typeof first?.path === 'string' ? normalizePath(first.path) : undefined;
};

const sameOrParentPath = (target: string, candidate: string): boolean => {
  const normalizedTarget = normalizePath(target).replace(/^\/+|\/+$/g, '');
  const normalizedCandidate = normalizePath(candidate).replace(/^\/+|\/+$/g, '');
  return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
