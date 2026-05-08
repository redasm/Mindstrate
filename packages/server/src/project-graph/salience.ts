import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphOverlayKind,
  type ContextEdge,
  type ContextNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';
import { scoreFirstFile } from './project-graph-report-shared.js';

export interface ProjectGraphSalienceInput {
  node: ContextNode;
  edges: ContextEdge[];
  overlays?: ProjectGraphOverlay[];
  changedPaths?: string[];
}

export const projectGraphNodeSalience = (input: ProjectGraphSalienceInput): number => {
  const kind = String(input.node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown');
  const evidencePath = primaryPath(input.node);
  const adjacent = input.edges.filter((edge) => edge.sourceId === input.node.id || edge.targetId === input.node.id);
  const incoming = adjacent.filter((edge) => edge.targetId === input.node.id).length;
  const outgoing = adjacent.filter((edge) => edge.sourceId === input.node.id).length;
  const exactOverlayBoost = (input.overlays ?? []).reduce((score, overlay) => {
    if (!overlayAppliesToNode(overlay, input.node, evidencePath)) return score;
    if (overlay.kind === ProjectGraphOverlayKind.CONFIRMATION) return score + 30;
    if (overlay.kind === ProjectGraphOverlayKind.CORRECTION) return score + 24;
    if (overlay.kind === ProjectGraphOverlayKind.RISK) return score + 18;
    if (overlay.kind === ProjectGraphOverlayKind.CONVENTION) return score + 10;
    return score + 6;
  }, 0);
  const changedBoost = evidencePath && (input.changedPaths ?? []).some((changed) => sameOrParentPath(changed, evidencePath)) ? 18 : 0;
  const edgeKindBoost = adjacent.reduce((score, edge) => score + edgeKindSalience(edge), 0);
  const generatedPenalty = input.node.metadata?.['generated'] === true || input.node.metadata?.['metadataOnly'] === true ? -28 : 0;
  const confidenceScore = Math.round((input.node.confidence ?? 0.5) * 20);
  const centralityScore = Math.min(35, incoming * 7 + outgoing * 4);
  const pathScore = evidencePath ? scoreFirstFile(evidencePath) : 0;

  return Math.min(99, Math.max(1, Math.round(
    kindBaseScore(kind)
    + pathScore
    + centralityScore
    + edgeKindBoost
    + confidenceScore
    + exactOverlayBoost
    + changedBoost
    + generatedPenalty,
  )));
};

export const sortProjectGraphNodesBySalience = (
  nodes: ContextNode[],
  edges: ContextEdge[],
  overlays: ProjectGraphOverlay[] = [],
): ContextNode[] => [...nodes].sort((left, right) =>
  projectGraphNodeSalience({ node: right, edges, overlays }) - projectGraphNodeSalience({ node: left, edges, overlays })
  || left.title.localeCompare(right.title));

const kindBaseScore = (kind: string): number => {
  if (kind === ProjectGraphNodeKind.PROJECT) return 80;
  if (kind === ProjectGraphNodeKind.MODULE) return 75;
  if (kind === ProjectGraphNodeKind.FILE) return 50;
  if (kind === ProjectGraphNodeKind.CLASS || kind === ProjectGraphNodeKind.COMPONENT) return 38;
  if (kind === ProjectGraphNodeKind.FUNCTION) return 30;
  if (kind === ProjectGraphNodeKind.CONFIG || kind === ProjectGraphNodeKind.ROUTE) return 28;
  if (kind === ProjectGraphNodeKind.DIRECTORY) return 22;
  if (kind === ProjectGraphNodeKind.DEPENDENCY) return 16;
  return 12;
};

const edgeKindSalience = (edge: ContextEdge): number => {
  const kind = edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind];
  if (kind === ProjectGraphEdgeKind.ENTRYPOINT_TO) return 12;
  if (kind === ProjectGraphEdgeKind.BINDS_TO) return 10;
  if (kind === ProjectGraphEdgeKind.REFERENCES_ASSET || kind === ProjectGraphEdgeKind.OWNS_ASSET) return 8;
  if (kind === ProjectGraphEdgeKind.CALLS || kind === ProjectGraphEdgeKind.IMPORTS || kind === ProjectGraphEdgeKind.DEPENDS_ON) return 5;
  return 2;
};

const primaryPath = (node: ContextNode): string | undefined => {
  const ownedByFile = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.ownedByFile];
  if (typeof ownedByFile === 'string') return normalizePath(ownedByFile);
  if (node.sourceRef) return normalizePath(node.sourceRef);
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  if (!Array.isArray(evidence)) return undefined;
  const first = evidence.find((entry) => entry && typeof entry === 'object' && 'path' in entry) as Record<string, unknown> | undefined;
  return typeof first?.path === 'string' ? normalizePath(first.path) : undefined;
};

const overlayAppliesToNode = (overlay: ProjectGraphOverlay, node: ContextNode, evidencePath: string | undefined): boolean => {
  if (overlay.targetNodeId === node.id) return true;
  if (!overlay.target) return false;
  if (overlay.target === `node:${node.id}`) return true;
  if (overlay.target.startsWith('path:') && evidencePath) return sameOrParentPath(overlay.target.slice('path:'.length), evidencePath);
  if (overlay.target.startsWith('symbol:')) return node.title === overlay.target.slice('symbol:'.length);
  return false;
};

const sameOrParentPath = (target: string, candidate: string): boolean => {
  const normalizedTarget = normalizePath(target).replace(/^\/+|\/+$/g, '');
  const normalizedCandidate = normalizePath(candidate).replace(/^\/+|\/+$/g, '');
  return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
};

const normalizePath = (value: string): string => value.replace(/\\/g, '/');
