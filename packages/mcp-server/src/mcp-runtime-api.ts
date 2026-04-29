import { TeamClient } from '@mindstrate/client';
import type {
  CreateKnowledgeInput, RetrievalContext, CuratedContext, EvolutionRunResult, Session, SaveObservationInput,
} from '@mindstrate/protocol';
import type pino from 'pino';
import type { LocalMemory, McpApi } from './types.js';
import { createBundleProjectionApi } from './mcp-bundle-projection-api.js';
import { runLocalMetabolismStage } from './local-metabolism-stage.js';
import { startVaultSync, type VaultSync } from './obsidian-vault-sync.js';

interface RuntimeApiOptions {
  teamServerUrl: string;
  teamApiKey: string;
  obsidianVaultPath: string;
  obsidianAutoSync: boolean;
  obsidianWatch: boolean;
  logger: pino.Logger;
}

export function createMcpApi(options: RuntimeApiOptions): McpApi {
  const isTeamMode = !!options.teamServerUrl;
  let memory: LocalMemory | null = null;
  let vaultSync: VaultSync | null = null;
  const teamClient = isTeamMode
    ? new TeamClient({ serverUrl: options.teamServerUrl, apiKey: options.teamApiKey })
    : null;

  const api: McpApi = {
    async init() {
      if (!isTeamMode) {
        let MindstrateClass: typeof import('@mindstrate/server').Mindstrate;
        try {
          ({ Mindstrate: MindstrateClass } = await import('@mindstrate/server'));
        } catch (err) {
          options.logger.fatal(
            { err },
            'Local mode requires @mindstrate/server to be installed. ' +
            'Either set TEAM_SERVER_URL to use team mode, or install the server package.',
          );
          throw err;
        }
        const localMemory = new MindstrateClass();
        memory = localMemory as unknown as LocalMemory;
        await localMemory.init();

        vaultSync = await startVaultSync(localMemory, options);
      }
      if (teamClient) {
        const ok = await teamClient.admin.health();
        if (!ok) options.logger.warn({ url: options.teamServerUrl }, 'Team Server is not reachable');
      }
    },

    async add(input: CreateKnowledgeInput) {
      if (teamClient) return teamClient.knowledge.add(input);
      return memory!.knowledge.add(input);
    },

    async get(id: string) {
      if (teamClient) return teamClient.knowledge.get(id);
      return memory!.context.readGraphKnowledge({ limit: 500 }).find((view) => view.id === id) ?? null;
    },

    async startSession(
      project: string,
      techContext?: string,
    ): Promise<{ session: Session; context: string | null }> {
      if (teamClient) {
        const result = await teamClient.sessions.start(project, techContext);
        return { session: result.session, context: result.context };
      }
      const session = await memory!.sessions.startSession({ project, techContext });
      const context = memory!.sessions.formatSessionContext(project);
      return { session, context: context || null };
    },

    async saveObservation(
      sessionId: string,
      type: string,
      content: string,
      metadata?: Record<string, string>,
    ) {
      if (teamClient) return teamClient.sessions.saveObservation(sessionId, type, content, metadata);
      memory!.sessions.saveObservation({ sessionId, type, content, metadata } as SaveObservationInput);
    },

    async endSession(sessionId: string, summary?: string, openTasks?: string[]) {
      if (teamClient) return teamClient.sessions.end(sessionId, summary, openTasks);
      if (summary) {
        memory!.sessions.compressSession({ sessionId, summary, openTasks });
      }
      await memory!.sessions.endSession(sessionId);
    },

    async getSession(id: string): Promise<Session | null> {
      if (teamClient) return teamClient.sessions.get(id);
      return memory!.sessions.getSession(id);
    },

    async getActiveSession(project: string): Promise<Session | null> {
      if (teamClient) return teamClient.sessions.getActive(project);
      return memory!.sessions.getActiveSession(project);
    },

    async formatSessionContext(project: string): Promise<string | null> {
      if (teamClient) {
        const result = await teamClient.sessions.restore(project);
        return result.formatted;
      }
      return memory!.sessions.formatSessionContext(project) || null;
    },

    async getStats() {
      if (teamClient) return teamClient.admin.getStats();
      return memory!.maintenance.getStats();
    },

    async recordFeedback(
      retrievalId: string,
      signal: 'adopted' | 'rejected' | 'ignored' | 'partial',
      context?: string,
    ) {
      if (teamClient) return teamClient.feedback.record(retrievalId, signal, context);
      memory!.context.recordFeedback(retrievalId, signal, context);
    },

    async curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext> {
      if (teamClient) return teamClient.context.curate(task, context);
      return memory!.assembly.curateContext(task, context);
    },

    async assembleContext(
      task: string,
      assemblyOptions?: { project?: string; context?: RetrievalContext; sessionId?: string },
    ) {
      if (teamClient) return teamClient.context.assemble(task, assemblyOptions);
      return memory!.assembly.assembleContext(task, assemblyOptions);
    },

    async runEvolution(
      options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' },
    ): Promise<EvolutionRunResult> {
      if (teamClient) return teamClient.admin.runEvolution(options);
      return memory!.metabolism.runEvolution(options);
    },

    async ingestContextEvent(input) {
      if (teamClient) return teamClient.context.ingestEvent(input);
      const result = memory!.events.ingestEvent(input as any);
      return { eventId: result.event.id, nodeId: result.node.id };
    },

    async queryContextGraph(queryOptions) {
      if (teamClient) return teamClient.context.queryGraph(queryOptions);
      return memory!.context.queryContextGraph(queryOptions as any);
    },

    async listContextEdges(queryOptions) {
      if (teamClient) return teamClient.context.listEdges(queryOptions);
      return memory!.context.listContextEdges(queryOptions as any);
    },

    async listContextConflicts(queryOptions) {
      if (teamClient) return teamClient.context.listConflicts(queryOptions);
      return memory!.context.listConflictRecords(queryOptions?.project, queryOptions?.limit);
    },

    async createProjectGraphOverlay(input) {
      if (teamClient) return teamClient.context.createProjectGraphOverlay(input);
      return memory!.context.createProjectGraphOverlay(input);
    },

    async listProjectGraphOverlays(queryOptions) {
      if (teamClient) return teamClient.context.listProjectGraphOverlays(queryOptions);
      return memory!.context.listProjectGraphOverlays(queryOptions);
    },

    async acceptConflictCandidate(input) {
      if (teamClient) return teamClient.context.acceptConflictCandidate(input);
      return memory!.metabolism.acceptConflictCandidate(input);
    },

    async rejectConflictCandidate(input) {
      if (teamClient) return teamClient.context.rejectConflictCandidate(input);
      return memory!.metabolism.rejectConflictCandidate(input);
    },

    async runMetabolism(options) {
      if (teamClient) return teamClient.metabolism.run(options);
      return memory!.metabolism.runMetabolism(options);
    },

    async runMetabolismStage(stage, options) {
      if (teamClient) return teamClient.metabolism.runStage(stage, options);
      return runLocalMetabolismStage(memory!, stage, options);
    },

    ...createBundleProjectionApi(teamClient, () => memory!),

    async readGraphKnowledge(opts?: { project?: string; limit?: number }) {
      if (teamClient) return teamClient.context.readKnowledge(opts);
      return memory!.context.readGraphKnowledge(opts);
    },

    async queryGraphKnowledge(query: string, opts?: { project?: string; topK?: number; limit?: number }) {
      if (teamClient) return teamClient.context.queryKnowledge(query, opts);
      return memory!.context.queryGraphKnowledge(query, opts);
    },

    close() {
      if (vaultSync) {
        void vaultSync.stop();
      }
      if (memory) memory.close();
    },
  };

  return api;
}
