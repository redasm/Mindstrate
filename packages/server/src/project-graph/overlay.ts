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

export interface CreateProjectGraphOverlayInput {
  project: string;
  targetNodeId?: string;
  targetEdgeId?: string;
  kind: ProjectGraphOverlayKind;
  content: string;
  author?: string;
  source: ProjectGraphOverlaySource;
}

export interface ListProjectGraphOverlayInput {
  project?: string;
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
    .filter((node) => !input.targetNodeId || node.metadata?.['targetNodeId'] === input.targetNodeId)
    .filter((node) => !input.targetEdgeId || node.metadata?.['targetEdgeId'] === input.targetEdgeId)
    .map(nodeToOverlay);

const nodeToOverlay = (node: ContextNode): ProjectGraphOverlay => ({
  id: node.id,
  project: node.project ?? '',
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
