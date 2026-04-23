import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../../context-graph/context-graph-store.js';
import { ingestContextEvent, type IngestContextEventResult } from '../context-event.js';

export interface IngestGitActivityInput {
  content: string;
  project?: string;
  actor?: string;
  sourceRef?: string;
  metadata?: Record<string, unknown>;
}

export function ingestGitActivity(
  graphStore: ContextGraphStore,
  input: IngestGitActivityInput,
): IngestContextEventResult {
  return ingestContextEvent(graphStore, {
    type: ContextEventType.GIT_ACTIVITY,
    content: input.content,
    project: input.project,
    actor: input.actor ?? 'git',
    domainType: ContextDomainType.ARCHITECTURE,
    substrateType: SubstrateType.EPISODE,
    title: `git activity: ${input.content.slice(0, 80)}`,
    tags: ['git-activity'],
    sourceRef: input.sourceRef,
    metadata: input.metadata,
  });
}
