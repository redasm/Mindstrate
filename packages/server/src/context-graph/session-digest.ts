import type { Session, SessionObservation } from '@mindstrate/protocol/models';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';

export function sessionObservationToEventType(type: SessionObservation['type']): ContextEventType {
  switch (type) {
    case 'knowledge_applied':
    case 'knowledge_rejected':
      return ContextEventType.FEEDBACK_SIGNAL;
    default:
      return ContextEventType.SESSION_OBSERVATION;
  }
}

export function sessionObservationToDomainType(type: SessionObservation['type']): ContextDomainType {
  switch (type) {
    case 'decision':
    case 'decision_path':
      return ContextDomainType.CONVENTION;
    case 'problem_solved':
      return ContextDomainType.BUG_FIX;
    case 'knowledge_applied':
    case 'knowledge_rejected':
      return ContextDomainType.CONTEXT_EVENT;
    case 'file_change':
      return ContextDomainType.CONTEXT_EVENT;
    default:
      return ContextDomainType.CONTEXT_EVENT;
  }
}

export function buildEpisodeTitle(
  type: SessionObservation['type'],
  content: string,
): string {
  const normalizedType = type.replace(/_/g, ' ');
  return `${normalizedType}: ${content.slice(0, 80)}`;
}

export interface DigestSessionObservationInput {
  graphStore: ContextGraphStore;
  sessionId: string;
  project?: string;
  observation: SessionObservation;
}

export function digestSessionObservation(input: DigestSessionObservationInput): {
  eventId: string;
  episodeNodeId: string;
} {
  const eventType = sessionObservationToEventType(input.observation.type);
  const domainType = sessionObservationToDomainType(input.observation.type);

  const event = input.graphStore.createEvent({
    type: eventType,
    project: input.project,
    sessionId: input.sessionId,
    actor: 'agent',
    content: input.observation.content,
    observedAt: input.observation.timestamp,
    metadata: {
      observationType: input.observation.type,
      ...(input.observation.metadata ?? {}),
    },
  });

  const episode = input.graphStore.createNode({
    substrateType: SubstrateType.EPISODE,
    domainType,
    title: buildEpisodeTitle(input.observation.type, input.observation.content),
    content: input.observation.content,
    tags: [
      'session-observation',
      input.observation.type,
    ],
    project: input.project,
    compressionLevel: 1,
    confidence: 0.8,
    qualityScore: 50,
    status: ContextNodeStatus.CANDIDATE,
    sourceRef: input.sessionId,
    metadata: {
      sessionId: input.sessionId,
      observationType: input.observation.type,
      ...(input.observation.metadata ?? {}),
    },
  });

  input.graphStore.createEdge({
    sourceId: episode.id,
    targetId: episode.id,
    relationType: ContextRelationType.OBSERVED_IN,
    strength: 1,
    evidence: {
      eventId: event.id,
      sessionId: input.sessionId,
    },
  });

  return {
    eventId: event.id,
    episodeNodeId: episode.id,
  };
}

export interface DigestCompletedSessionInput {
  graphStore: ContextGraphStore;
  session: Session;
}

export function digestCompletedSession(input: DigestCompletedSessionInput): {
  snapshotNodeId: string;
} {
  const summary = buildSessionSnapshotContent(input.session);
  const existing = input.graphStore.listNodes({
    sourceRef: input.session.id,
    substrateType: SubstrateType.SNAPSHOT,
    domainType: ContextDomainType.SESSION_SUMMARY,
    limit: 1,
  })[0];

  const snapshot = existing
    ? input.graphStore.updateNode(existing.id, {
      title: buildSnapshotTitle(input.session),
      content: summary,
      tags: ['session-snapshot', 'session-summary'],
      project: input.session.project || undefined,
      compressionLevel: 0.2,
      confidence: 0.9,
      qualityScore: 70,
      status: ContextNodeStatus.ACTIVE,
      metadata: buildSessionSnapshotMetadata(input.session),
    })!
    : input.graphStore.createNode({
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      title: buildSnapshotTitle(input.session),
      content: summary,
      tags: ['session-snapshot', 'session-summary'],
      project: input.session.project || undefined,
      compressionLevel: 0.2,
      confidence: 0.9,
      qualityScore: 70,
      status: ContextNodeStatus.ACTIVE,
      sourceRef: input.session.id,
      metadata: buildSessionSnapshotMetadata(input.session),
    });

  const episodes = input.graphStore.listNodes({
    sourceRef: input.session.id,
    substrateType: SubstrateType.EPISODE,
    limit: 500,
  });

  for (const episode of episodes) {
    const exists = input.graphStore.listOutgoingEdges(episode.id, ContextRelationType.DERIVED_FROM)
      .some((edge) => edge.targetId === snapshot.id);
    if (exists) continue;

    input.graphStore.createEdge({
      sourceId: episode.id,
      targetId: snapshot.id,
      relationType: ContextRelationType.DERIVED_FROM,
      strength: 1,
      evidence: {
        sessionId: input.session.id,
      },
    });
  }

  return {
    snapshotNodeId: snapshot.id,
  };
}

function buildSnapshotTitle(session: Session): string {
  const project = session.project || 'default';
  return `Session snapshot: ${project}`;
}

export function buildSessionSnapshotContent(session: Session): string {
  const parts: string[] = [];

  if (session.summary) {
    parts.push(`Summary: ${session.summary}`);
  }
  if (session.decisions?.length) {
    parts.push(`Decisions:\n${session.decisions.map((item) => `- ${item}`).join('\n')}`);
  }
  if (session.problemsSolved?.length) {
    parts.push(`Problems Solved:\n${session.problemsSolved.map((item) => `- ${item}`).join('\n')}`);
  }
  if (session.openTasks?.length) {
    parts.push(`Open Tasks:\n${session.openTasks.map((item) => `- ${item}`).join('\n')}`);
  }
  if (session.filesModified?.length) {
    parts.push(`Files Modified:\n${session.filesModified.map((item) => `- ${item}`).join('\n')}`);
  }

  return parts.join('\n\n').trim() || 'Session completed without a structured summary.';
}

function buildSessionSnapshotMetadata(session: Session): Record<string, unknown> {
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    techContext: session.techContext,
    openTasks: session.openTasks ?? [],
    decisions: session.decisions ?? [],
    problemsSolved: session.problemsSolved ?? [],
    filesModified: session.filesModified ?? [],
  };
}
