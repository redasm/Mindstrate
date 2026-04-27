import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  MetabolismStage,
  SubstrateType,
  type ContextEvent,
  type ContextNode,
  type MetabolismStageStats,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { MetabolismStageOptions } from './metabolism-engine.js';

export class DigestEngine {
  constructor(private readonly graphStore: ContextGraphStore) {}

  run(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.DIGEST } {
    const events = this.graphStore.listEvents({
      project: options.project,
      limit: 1000,
    });
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });
    const episodesByEventId = new Map(
      episodes
        .map((node) => [node.metadata?.['eventId'], node] as const)
        .filter((entry): entry is [string, ContextNode] => typeof entry[0] === 'string'),
    );
    let created = 0;
    let updated = 0;

    for (const event of events) {
      const normalizedEvent = normalizeEvent(event);
      const existing = episodesByEventId.get(event.id) ?? findMatchingRawEpisode(episodes, event);
      if (existing) {
        if (!existing.metadata?.['normalizedEvent']) {
          this.graphStore.updateNode(existing.id, {
            metadata: {
              ...(existing.metadata ?? {}),
              eventId: event.id,
              eventType: event.type,
              normalizedEvent,
            },
          });
          updated++;
        }
        continue;
      }

      this.graphStore.createNode({
        substrateType: SubstrateType.EPISODE,
        domainType: domainTypeForEvent(event.type),
        title: buildDigestNodeTitle(event),
        content: event.content,
        tags: ['context-event', event.type],
        project: event.project,
        sourceRef: `event:${event.id}`,
        confidence: 0.7,
        qualityScore: 50,
        status: ContextNodeStatus.CANDIDATE,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          normalizedEvent,
          ...(event.metadata ?? {}),
        },
      });
      created++;
    }

    return {
      stage: MetabolismStage.DIGEST,
      scanned: events.length,
      created,
      updated,
      skipped: Math.max(events.length - created - updated, 0),
    };
  }
}

function normalizeEvent(event: ContextEvent): Record<string, unknown> {
  return {
    type: event.type,
    source: event.actor ?? event.type,
    observedAt: event.observedAt,
    summary: event.content.trim(),
    ...pickEventMetadata(event),
  };
}

function pickEventMetadata(event: ContextEvent): Record<string, unknown> {
  const metadata = event.metadata ?? {};
  switch (event.type) {
    case ContextEventType.TERMINAL_OUTPUT:
      return {
        command: metadata['command'],
        exitCode: metadata['exitCode'],
      };
    case ContextEventType.TEST_RESULT:
      return {
        testSuite: metadata['testSuite'],
        status: metadata['status'],
      };
    case ContextEventType.LSP_DIAGNOSTIC:
      return {
        file: metadata['file'],
        severity: metadata['severity'],
      };
    case ContextEventType.GIT_ACTIVITY:
      return {
        branch: metadata['branch'],
        commit: metadata['commit'],
      };
    case ContextEventType.FEEDBACK_SIGNAL:
      return {
        retrievalId: metadata['retrievalId'],
        signal: metadata['signal'],
      };
    default:
      return {};
  }
}

function domainTypeForEvent(type: ContextEventType): ContextDomainType {
  switch (type) {
    case ContextEventType.GIT_ACTIVITY:
      return ContextDomainType.ARCHITECTURE;
    case ContextEventType.TEST_RESULT:
    case ContextEventType.LSP_DIAGNOSTIC:
    case ContextEventType.TERMINAL_OUTPUT:
      return ContextDomainType.TROUBLESHOOTING;
    case ContextEventType.USER_EDIT:
      return ContextDomainType.BEST_PRACTICE;
    default:
      return ContextDomainType.CONTEXT_EVENT;
  }
}

function buildDigestNodeTitle(event: ContextEvent): string {
  return `${event.type.replace(/_/g, ' ')}: ${event.content.slice(0, 80)}`;
}

function findMatchingRawEpisode(episodes: ContextNode[], event: ContextEvent): ContextNode | undefined {
  return episodes.find((node) =>
    node.metadata?.['eventId'] === undefined
    && node.project === event.project
    && node.content.trim() === event.content.trim()
  );
}
