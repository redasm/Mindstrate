import { createHash } from 'node:crypto';
import type { ProjectGraphEdgeKind, ProjectGraphNodeKind } from '@mindstrate/protocol/models';

export interface CreateProjectGraphNodeIdInput {
  project: string;
  kind: ProjectGraphNodeKind;
  key: string;
}

export interface CreateProjectGraphEdgeIdInput {
  sourceId: string;
  targetId: string;
  kind: ProjectGraphEdgeKind;
}

export const createProjectGraphNodeId = (input: CreateProjectGraphNodeIdInput): string => {
  const project = normalizeSegment(input.project);
  const key = normalizeSegment(input.key);
  return `pg:${project}:${input.kind}:${hashStable(`${project}\0${input.kind}\0${key}`)}`;
};

export const createProjectGraphEdgeId = (input: CreateProjectGraphEdgeIdInput): string => {
  const sourceId = normalizeSegment(input.sourceId);
  const targetId = normalizeSegment(input.targetId);
  return `pge:${input.kind}:${hashStable(`${sourceId}\0${input.kind}\0${targetId}`)}`;
};

const normalizeSegment = (value: string): string =>
  value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();

const hashStable = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
