import type {
  CompressSessionInput,
  CreateSessionInput,
  SaveObservationInput,
  Session,
  SessionContext,
} from '@mindstrate/protocol';
import { ContextDomainType, SubstrateType } from '@mindstrate/protocol/models';
import type { MindstrateRuntime } from './mindstrate-runtime.js';
import { digestCompletedSession, digestSessionObservation } from '../context-graph/session-digest.js';

export class MindstrateSessionApi {
  constructor(private readonly services: MindstrateRuntime) {}

  async startSession(input: CreateSessionInput = {}): Promise<Session> {
    const active = this.services.sessionStore.getActiveSession(input.project);
    if (active) {
      this.services.feedbackLoop.resolveTimeouts(active.id);
      if (!active.summary && (active.observations?.length ?? 0) > 0) {
        try {
          await this.autoCompressSession(active.id);
        } catch (err) {
          console.warn(
            `[Mindstrate] Failed to auto-compress session ${active.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.services.sessionStore.endSession(active.id, 'abandoned');
    }
    return this.services.sessionStore.create(input);
  }

  saveObservation(input: SaveObservationInput): void {
    this.services.sessionStore.addObservation(input);

    const session = this.services.sessionStore.getById(input.sessionId);
    if (!session) return;

    digestSessionObservation({
      graphStore: this.services.contextGraphStore,
      sessionId: input.sessionId,
      project: session.project || undefined,
      observation: {
        timestamp: new Date().toISOString(),
        type: input.type,
        content: input.content,
        metadata: input.metadata,
      },
    });
  }

  compressSession(input: CompressSessionInput): void {
    this.services.sessionStore.compress(input);
  }

  async autoCompressSession(sessionId: string): Promise<CompressSessionInput | null> {
    const session = this.services.sessionStore.getById(sessionId);
    if (!session) return null;

    const result = await this.services.sessionCompressor.compress(session);
    this.services.sessionStore.compress(result);
    return result;
  }

  async endSession(sessionId: string): Promise<void> {
    let session = this.services.sessionStore.getById(sessionId);
    if (!session) return;

    this.services.feedbackLoop.resolveTimeouts(sessionId);

    if (!session.summary && (session.observations?.length ?? 0) > 0) {
      await this.autoCompressSession(sessionId);
      session = this.services.sessionStore.getById(sessionId);
      if (!session) return;
    }

    this.services.sessionStore.endSession(sessionId, 'completed');
    const completedSession = this.services.sessionStore.getById(sessionId);
    if (completedSession) {
      digestCompletedSession({
        graphStore: this.services.contextGraphStore,
        session: completedSession,
      });
      await this.compressCompletedSessionGraph(completedSession);
    }
  }

  restoreSessionContext(project: string = ''): SessionContext {
    const context = this.services.sessionStore.restoreContext(project);
    const graphSnapshots = this.services.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: 5,
    });

    if (graphSnapshots.length > 0) {
      context.graphSnapshots = graphSnapshots.map((node) => ({
        nodeId: node.id,
        title: node.title,
        summary: node.content,
        endedAt: typeof node.metadata?.['endedAt'] === 'string'
          ? node.metadata['endedAt']
          : undefined,
      }));
    }

    return context;
  }

  formatSessionContext(project: string = ''): string {
    const ctx = this.restoreSessionContext(project);
    return this.services.sessionStore.formatContextForInjection(ctx);
  }

  getActiveSession(project: string = ''): Session | null {
    return this.services.sessionStore.getActiveSession(project);
  }

  getSession(id: string): Session | null {
    return this.services.sessionStore.getById(id);
  }

  getRecentSessions(project: string = '', limit: number = 10): Session[] {
    return this.services.sessionStore.getRecentSessions(project, limit);
  }

  private async compressCompletedSessionGraph(session: Session): Promise<void> {
    const project = session.project || undefined;
    const summaryResult = await this.services.summaryCompressor.compressProjectSnapshots({ project });
    if (summaryResult.summaryNodesCreated === 0) return;

    const patternResult = await this.services.patternCompressor.compressProjectSummaries({ project });
    if (patternResult.patternNodesCreated === 0) return;

    const ruleResult = await this.services.ruleCompressor.compressProjectPatterns({ project });
    if (ruleResult.ruleNodesCreated === 0) return;

    const conflictResult = await this.services.conflictDetector.detectConflicts({
      project,
      substrateType: SubstrateType.RULE,
    });
    if (conflictResult.conflictsDetected > 0) {
      this.services.conflictReflector.reflectConflicts({ project });
    }
  }
}
