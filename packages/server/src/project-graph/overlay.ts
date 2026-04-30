import { randomUUID } from 'node:crypto';
import {
  ContextDomainType,
  ContextNodeStatus,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  SubstrateType,
  type ContextNode,
  type ProjectGraphOverlay,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

export const PROJECT_GRAPH_OVERLAY_BLOCK = 'overlay';
const OVERLAY_BLOCK_START = '<!-- mindstrate:project-graph:overlay:start -->';
const OVERLAY_BLOCK_END = '<!-- mindstrate:project-graph:overlay:end -->';

export interface CreateProjectGraphOverlayInput {
  project: string;
  target?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  kind: ProjectGraphOverlayKind;
  content: string;
  author?: string;
  source: ProjectGraphOverlaySource;
}

export interface ParsedProjectGraphOverlay {
  kind: ProjectGraphOverlayKind;
  content: string;
  target?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
}

export interface ListProjectGraphOverlayInput {
  project?: string;
  target?: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  limit?: number;
}

export const createProjectGraphOverlay = (
  store: ContextGraphStore,
  input: CreateProjectGraphOverlayInput,
): ProjectGraphOverlay => {
  const id = `project-graph-overlay:${randomUUID()}`;
  const node = store.createNode({
    id,
    substrateType: SubstrateType.EPISODE,
    domainType: ContextDomainType.ARCHITECTURE,
    title: `Project graph ${input.kind}`,
    content: input.content,
    tags: ['project-graph-overlay', input.kind],
    project: input.project,
    status: ContextNodeStatus.ACTIVE,
    sourceRef: input.targetNodeId ?? input.targetEdgeId,
    confidence: 1,
    qualityScore: 80,
    metadata: {
      projectGraphOverlay: true,
      target: input.target,
      targetNodeId: input.targetNodeId,
      targetEdgeId: input.targetEdgeId,
      kind: input.kind,
      source: input.source,
      author: input.author,
    },
  });
  return nodeToOverlay(node);
};

export const listProjectGraphOverlays = (
  store: ContextGraphStore,
  input: ListProjectGraphOverlayInput = {},
): ProjectGraphOverlay[] =>
  store.listNodes({
    project: input.project,
    domainType: ContextDomainType.ARCHITECTURE,
    limit: input.limit ?? 200,
  })
    .filter((node) => node.metadata?.['projectGraphOverlay'] === true)
    .filter((node) => !input.target || node.metadata?.['target'] === input.target)
    .filter((node) => !input.targetNodeId || node.metadata?.['targetNodeId'] === input.targetNodeId)
    .filter((node) => !input.targetEdgeId || node.metadata?.['targetEdgeId'] === input.targetEdgeId)
    .map(nodeToOverlay);

export const parseProjectGraphOverlayBlock = (text: string): ParsedProjectGraphOverlay[] => {
  const body = extractOverlayBlockBody(text);
  if (!body) return [];
  return parseOverlayEntries(body)
    .map(parseOverlayEntry)
    .filter((entry): entry is ParsedProjectGraphOverlay => entry !== null);
};

export const renderProjectGraphOverlayBlock = (overlays: ProjectGraphOverlay[]): string => [
  OVERLAY_BLOCK_START,
  ...(overlays.length > 0
    ? overlays.flatMap((overlay) => [
      `- kind: ${overlay.kind}`,
      ...(overlayTarget(overlay) ? [`  target: ${overlayTarget(overlay)}`] : []),
      `  content: ${overlay.content}`,
    ])
    : ['- kind: note', '  content: Add graph confirmations, corrections, risks, or conventions here.']),
  OVERLAY_BLOCK_END,
].join('\n');

const nodeToOverlay = (node: ContextNode): ProjectGraphOverlay => ({
  id: node.id,
  project: node.project ?? '',
  target: stringOrUndefined(node.metadata?.['target']),
  targetNodeId: stringOrUndefined(node.metadata?.['targetNodeId']),
  targetEdgeId: stringOrUndefined(node.metadata?.['targetEdgeId']),
  kind: (node.metadata?.['kind'] as ProjectGraphOverlayKind) ?? ProjectGraphOverlayKind.NOTE,
  content: node.content,
  author: stringOrUndefined(node.metadata?.['author']),
  source: (node.metadata?.['source'] as ProjectGraphOverlaySource) ?? ProjectGraphOverlaySource.CLI,
  createdAt: node.createdAt,
  updatedAt: node.updatedAt,
});

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const extractOverlayBlockBody = (text: string): string => {
  const startIndex = text.indexOf(OVERLAY_BLOCK_START);
  const endIndex = text.indexOf(OVERLAY_BLOCK_END);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return '';
  return text.slice(startIndex + OVERLAY_BLOCK_START.length, endIndex).trim();
};

const parseOverlayEntries = (body: string): Array<Record<string, string>> => {
  const entries: Array<Record<string, string>> = [];
  let current: Record<string, string> | undefined;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('- ')) {
      if (current) entries.push(current);
      current = {};
      assignOverlayField(current, line.slice(2));
      continue;
    }
    if (current) assignOverlayField(current, line);
  }
  if (current) entries.push(current);
  return entries;
};

const assignOverlayField = (entry: Record<string, string>, line: string): void => {
  const separator = line.indexOf(':');
  if (separator < 0) return;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (key) entry[key] = value;
};

const parseOverlayEntry = (entry: Record<string, string>): ParsedProjectGraphOverlay | null => {
  const kind = overlayKind(entry.kind);
  if (!kind || !entry.content) return null;
  return {
    kind,
    content: entry.content,
    target: entry.target,
    targetNodeId: targetId(entry.target, 'node'),
    targetEdgeId: targetId(entry.target, 'edge'),
  };
};

const overlayKind = (value?: string): ProjectGraphOverlayKind | undefined =>
  Object.values(ProjectGraphOverlayKind).find((kind) => kind === value);

const targetId = (target: string | undefined, prefix: 'node' | 'edge'): string | undefined => {
  const marker = `${prefix}:`;
  return target?.startsWith(marker) ? target.slice(marker.length) : undefined;
};

const overlayTarget = (overlay: ProjectGraphOverlay): string | undefined => {
  if (overlay.target) return overlay.target;
  if (overlay.targetNodeId) return `node:${overlay.targetNodeId}`;
  if (overlay.targetEdgeId) return `edge:${overlay.targetEdgeId}`;
  return undefined;
};
