#!/usr/bin/env node
/**
 * Mindstrate MCP Server
 *
 * Speaks the Model Context Protocol (stdio) to AI coding assistants
 * (Cursor, OpenCode, Claude Desktop, ...) and exposes the team
 * knowledge base as a set of tools and resources.
 *
 * Two modes, chosen by env at startup:
 *   - Team mode (default for distributed installs)
 *       TEAM_SERVER_URL set -> uses @mindstrate/client over HTTP.
 *       Requires only protocol+client, no native modules. ~100KB.
 *
 *   - Local mode (single-developer install)
 *       TEAM_SERVER_URL unset -> dynamically loads @mindstrate/server
 *       (which depends on better-sqlite3). The server package is an
 *       OPTIONAL peer dependency: it is only required for local mode.
 *
 * Tools:    memory_search, memory_add, memory_feedback, memory_feedback_auto,
 *           memory_curate, memory_evolve, session_start, session_save,
 *           session_end, session_restore
 * Resources: memory://stats
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TeamClient } from '@mindstrate/client';
import type {
  CreateKnowledgeInput,
  RetrievalContext,
  CuratedContext,
  EvolutionRunResult,
  Session,
  SaveObservationInput,
} from '@mindstrate/protocol';
import { z } from 'zod';
import pino from 'pino';

// Tool & Resource modules
import { TOOL_DEFINITIONS } from './tools/definitions.js';
import {
  GraphKnowledgeSearchSchema,
  ContextIngestEventSchema,
  ContextQueryGraphSchema,
  ContextEdgesSchema,
  ContextConflictsSchema,
  ContextConflictAcceptSchema,
  ContextConflictRejectSchema,
  MetabolismRunSchema,
  ObsidianProjectionWriteSchema,
  ObsidianProjectionImportSchema,
  BundleCreateSchema,
  BundleValidateSchema,
  BundleInstallSchema,
  BundlePublishSchema,
  MemorySearchSchema,
  MemoryAddSchema,
  MemoryFeedbackSchema,
  SessionSaveSchema,
  MemoryFeedbackAutoSchema,
  MemoryCurateSchema,
  ContextAssembleSchema,
  ContextInternalizeSchema,
  MemoryEvolveSchema,
} from './tools/schemas.js';
import {
  handleGraphKnowledgeSearch,
  handleContextIngestEvent,
  handleContextQueryGraph,
  handleContextEdges,
  handleContextConflicts,
  handleContextConflictAccept,
  handleContextConflictReject,
  handleMetabolismRun,
  handleObsidianProjectionWrite,
  handleObsidianProjectionImport,
  handleBundleCreate,
  handleBundleValidate,
  handleBundleInstall,
  handleBundlePublish,
  handleMemorySearch,
  handleMemoryAdd,
  handleMemoryFeedback,
  handleSessionStart,
  handleSessionSave,
  handleSessionEnd,
  handleSessionRestore,
  handleMemoryFeedbackAuto,
  handleMemoryCurate,
  handleContextAssemble,
  handleContextInternalize,
  handleMemoryEvolve,
} from './tools/handlers.js';
import { RESOURCE_DEFINITIONS, handleReadResource } from './resources/handlers.js';
import type { McpApi, SessionState, LocalMemory } from './types.js';

// ============================================================
// Logger (writes to stderr to avoid corrupting MCP stdio)
// ============================================================

// Note: write to stderr file descriptor (2) directly via pino's destination
// option, NOT via a `transport` worker. Transport workers don't survive
// esbuild bundling because they spawn separate Node processes that can't
// resolve our bundled paths.
const logger = pino(
  { level: process.env['LOG_LEVEL'] ?? 'info' },
  pino.destination(2),
);

// ============================================================
// Mode detection
// ============================================================

const TEAM_SERVER_URL = process.env['TEAM_SERVER_URL'] ?? '';
const TEAM_API_KEY = process.env['TEAM_API_KEY'] ?? '';
const isTeamMode = !!TEAM_SERVER_URL;

let memory: LocalMemory | null = null;
const teamClient = isTeamMode
  ? new TeamClient({ serverUrl: TEAM_SERVER_URL, apiKey: TEAM_API_KEY })
  : null;

// Optional Obsidian vault sync (local mode only)
const OBSIDIAN_VAULT_PATH = process.env['OBSIDIAN_VAULT_PATH'] ?? '';
const OBSIDIAN_AUTO_SYNC = process.env['OBSIDIAN_AUTO_SYNC'] !== 'false';
const OBSIDIAN_WATCH = process.env['OBSIDIAN_WATCH'] === 'true';
let vaultSync: { exportAll(): Promise<{ written: number; removed: number }>; startWatching(): void; stop(): Promise<void> } | null = null;

// 追踪当前活跃会话
const sessionState: SessionState = {
  currentSessionId: null,
  currentSessionProject: '',
};

// ============================================================
// Unified API — abstracts local/team differences
// ============================================================

const api: McpApi = {
  async init() {
    if (!isTeamMode) {
      // Lazy-load the server package only when running in local mode.
      // This keeps the team-only distribution free of better-sqlite3
      // and any other native deps. The package is declared as an
      // optionalPeerDependency in package.json — if it's not installed,
      // local mode is unavailable but the rest of the binary still works.
      let MindstrateClass: typeof import('@mindstrate/server').Mindstrate;
      try {
        ({ Mindstrate: MindstrateClass } = await import('@mindstrate/server'));
      } catch (err) {
        logger.fatal(
          { err },
          'Local mode requires @mindstrate/server to be installed. ' +
          'Either set TEAM_SERVER_URL to use team mode, or install the server package.',
        );
        throw err;
      }
      const localMemory = new MindstrateClass();
      memory = localMemory;
      await localMemory.init();

      if (OBSIDIAN_VAULT_PATH && OBSIDIAN_AUTO_SYNC) {
        try {
          const { SyncManager } = await import('@mindstrate/obsidian-sync');
          vaultSync = new SyncManager(localMemory as any, { vaultRoot: OBSIDIAN_VAULT_PATH, silent: true });
          const r = await vaultSync!.exportAll();
          logger.info(
            { written: r.written, removed: r.removed, vaultPath: OBSIDIAN_VAULT_PATH },
            'Obsidian vault synced',
          );
          if (OBSIDIAN_WATCH) {
            vaultSync!.startWatching();
            logger.info({ vaultPath: OBSIDIAN_VAULT_PATH }, 'Obsidian vault watcher started');
          }
        } catch (err) {
          logger.warn({ err }, 'Obsidian vault sync unavailable (package missing or initial sync failed)');
        }
      }
    }
    if (teamClient) {
      const ok = await teamClient.health();
      if (!ok) logger.warn({ url: TEAM_SERVER_URL }, 'Team Server is not reachable');
    }
  },

  async add(input: CreateKnowledgeInput) {
    if (teamClient) return teamClient.add(input);
    return memory!.add(input);
  },

  async get(id: string) {
    if (teamClient) return teamClient.get(id);
    return memory!.readGraphKnowledge({ limit: 500 }).find((view) => view.id === id) ?? null;
  },

  async startSession(project: string, techContext?: string): Promise<{ session: Session; context: string | null }> {
    if (teamClient) {
      const result = await teamClient.startSession(project, techContext);
      return { session: result.session, context: result.context };
    }
    const session = await memory!.startSession({ project, techContext });
    const context = memory!.formatSessionContext(project);
    return { session, context: context || null };
  },

  async saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>) {
    if (teamClient) return teamClient.saveObservation(sessionId, type, content, metadata);
    memory!.saveObservation({ sessionId, type, content, metadata } as SaveObservationInput);
  },

  async endSession(sessionId: string, summary?: string, openTasks?: string[]) {
    if (teamClient) return teamClient.endSession(sessionId, summary, openTasks);
    if (summary) {
      memory!.compressSession({ sessionId, summary, openTasks });
    }
    await memory!.endSession(sessionId);
  },

  async getSession(id: string): Promise<Session | null> {
    if (teamClient) return teamClient.getSession(id);
    return memory!.getSession(id);
  },

  async getActiveSession(project: string): Promise<Session | null> {
    if (teamClient) return teamClient.getActiveSession(project);
    return memory!.getActiveSession(project);
  },

  async formatSessionContext(project: string): Promise<string | null> {
    if (teamClient) {
      const result = await teamClient.restoreSession(project);
      return result.formatted;
    }
    return memory!.formatSessionContext(project) || null;
  },

  async getStats() {
    if (teamClient) return teamClient.getStats();
    return memory!.getStats();
  },

  async recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string) {
    if (teamClient) return teamClient.recordFeedback(retrievalId, signal, context);
    memory!.recordFeedback(retrievalId, signal, context);
  },

  async curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext> {
    if (teamClient) return teamClient.curateContext(task, context);
    return memory!.curateContext(task, context);
  },

  async assembleContext(
    task: string,
    options?: { project?: string; context?: RetrievalContext; sessionId?: string },
  ) {
    if (teamClient) return teamClient.assembleContext(task, options);
    return memory!.assembleContext(task, options);
  },

  async runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult> {
    if (teamClient) return teamClient.runEvolution(options);
    return memory!.runEvolution(options);
  },

  async ingestContextEvent(input) {
    if (teamClient) return teamClient.ingestContextEvent(input);
    const result = memory!.ingestEvent(input);
    return { eventId: result.event.id, nodeId: result.node.id };
  },

  async queryContextGraph(options) {
    if (teamClient) return teamClient.queryContextGraph(options);
    return memory!.queryContextGraph(options);
  },

  async listContextEdges(options) {
    if (teamClient) return teamClient.listContextEdges(options);
    return memory!.listContextEdges(options);
  },

  async listContextConflicts(options) {
    if (teamClient) return teamClient.listContextConflicts(options);
    return memory!.listConflictRecords(options?.project, options?.limit);
  },

  async acceptConflictCandidate(input) {
    if (teamClient) return teamClient.acceptConflictCandidate(input);
    return memory!.acceptConflictCandidate(input);
  },

  async rejectConflictCandidate(input) {
    if (teamClient) return teamClient.rejectConflictCandidate(input);
    return memory!.rejectConflictCandidate(input);
  },

  async runMetabolism(options) {
    if (teamClient) return teamClient.runMetabolism(options);
    return memory!.runMetabolism(options);
  },

  async runMetabolismStage(stage, options) {
    if (teamClient) return teamClient.runMetabolismStage(stage, options);
    switch (stage) {
      case 'digest':
        return memory!.runDigest(options);
      case 'assimilate':
        return memory!.runAssimilation(options);
      case 'compress':
        return memory!.runCompression(options);
      case 'prune':
        return memory!.runPruning(options);
      case 'reflect':
        return memory!.runReflection(options);
    }
  },

  async createBundle(options) {
    if (teamClient) return teamClient.createBundle(options);
    return memory!.createBundle(options);
  },

  async validateBundle(bundle) {
    if (teamClient) return teamClient.validateBundle(bundle);
    return memory!.validateBundle(bundle);
  },

  async installBundle(bundle) {
    if (teamClient) return teamClient.installBundle(bundle);
    return memory!.installBundle(bundle);
  },

  async installBundleFromRegistry(options) {
    if (teamClient) return teamClient.installBundleFromRegistry(options);
    return memory!.installBundleFromRegistry(options);
  },

  async publishBundle(bundle, options) {
    if (teamClient) return teamClient.publishBundle(bundle, options);
    return memory!.publishBundle(bundle, options);
  },

  async generateInternalizationSuggestions(options) {
    if (teamClient) return teamClient.generateInternalizationSuggestions(options);
    return memory!.generateInternalizationSuggestions(options);
  },

  async writeObsidianProjectionFiles(options) {
    if (teamClient) return teamClient.writeObsidianProjectionFiles(options);
    return { files: memory!.writeObsidianProjectionFiles(options) };
  },

  async importObsidianProjectionFile(filePath) {
    if (teamClient) return teamClient.importObsidianProjectionFile(filePath);
    return memory!.importObsidianProjectionFile(filePath);
  },

  async readGraphKnowledge(opts?: { project?: string; limit?: number }) {
    if (teamClient) return teamClient.readGraphKnowledge(opts);
    return memory!.readGraphKnowledge(opts);
  },

  async queryGraphKnowledge(query: string, opts?: { project?: string; topK?: number; limit?: number }) {
    if (teamClient) return teamClient.queryGraphKnowledge(query, opts);
    return memory!.queryGraphKnowledge(query, opts);
  },

  close() {
    if (vaultSync) {
      void vaultSync.stop();
    }
    if (memory) memory.close();
  },
};

// ============================================================
// Zod validation helper
// ============================================================

function validateArgs<T>(schema: z.ZodSchema<T>, args: unknown): { data: T } | { error: { content: Array<{ type: string; text: string }>; isError: true } } {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    logger.warn({ issues, args }, 'MCP tool input validation failed');
    return {
      error: {
        content: [{ type: 'text', text: `Invalid input: ${issues}` }],
        isError: true,
      },
    };
  }
  return { data: result.data };
}

// ============================================================
// MCP Server setup
// ============================================================

const server = new Server(
  {
    name: 'mindstrate',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// Tools: list
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOL_DEFINITIONS };
});

// Tools: call
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'memory_search': {
      const v = validateArgs(MemorySearchSchema, args);
      if ('error' in v) return v.error;
      return handleMemorySearch(api, v.data);
    }
    case 'graph_knowledge_search': {
      const v = validateArgs(GraphKnowledgeSearchSchema, args);
      if ('error' in v) return v.error;
      return handleGraphKnowledgeSearch(api, v.data);
    }
    case 'context_ingest_event': {
      const v = validateArgs(ContextIngestEventSchema, args);
      if ('error' in v) return v.error;
      return handleContextIngestEvent(api, v.data);
    }
    case 'context_query_graph': {
      const v = validateArgs(ContextQueryGraphSchema, args);
      if ('error' in v) return v.error;
      return handleContextQueryGraph(api, v.data);
    }
    case 'context_edges': {
      const v = validateArgs(ContextEdgesSchema, args);
      if ('error' in v) return v.error;
      return handleContextEdges(api, v.data);
    }
    case 'context_conflicts': {
      const v = validateArgs(ContextConflictsSchema, args);
      if ('error' in v) return v.error;
      return handleContextConflicts(api, v.data);
    }
    case 'context_conflict_accept': {
      const v = validateArgs(ContextConflictAcceptSchema, args);
      if ('error' in v) return v.error;
      return handleContextConflictAccept(api, v.data);
    }
    case 'context_conflict_reject': {
      const v = validateArgs(ContextConflictRejectSchema, args);
      if ('error' in v) return v.error;
      return handleContextConflictReject(api, v.data);
    }
    case 'metabolism_run': {
      const v = validateArgs(MetabolismRunSchema, args);
      if ('error' in v) return v.error;
      return handleMetabolismRun(api, v.data);
    }
    case 'context_obsidian_projection_write': {
      const v = validateArgs(ObsidianProjectionWriteSchema, args);
      if ('error' in v) return v.error;
      return handleObsidianProjectionWrite(api, v.data);
    }
    case 'context_obsidian_projection_import': {
      const v = validateArgs(ObsidianProjectionImportSchema, args);
      if ('error' in v) return v.error;
      return handleObsidianProjectionImport(api, v.data);
    }
    case 'bundle_create': {
      const v = validateArgs(BundleCreateSchema, args);
      if ('error' in v) return v.error;
      return handleBundleCreate(api, v.data);
    }
    case 'bundle_validate': {
      const v = validateArgs(BundleValidateSchema, args);
      if ('error' in v) return v.error;
      return handleBundleValidate(api, v.data);
    }
    case 'bundle_install': {
      const v = validateArgs(BundleInstallSchema, args);
      if ('error' in v) return v.error;
      return handleBundleInstall(api, v.data);
    }
    case 'bundle_publish': {
      const v = validateArgs(BundlePublishSchema, args);
      if ('error' in v) return v.error;
      return handleBundlePublish(api, v.data);
    }
    case 'memory_add': {
      const v = validateArgs(MemoryAddSchema, args);
      if ('error' in v) return v.error;
      return handleMemoryAdd(api, v.data);
    }
    case 'memory_feedback': {
      const v = validateArgs(MemoryFeedbackSchema, args);
      if ('error' in v) return v.error;
      return handleMemoryFeedback(api, v.data);
    }
    case 'session_start':
      return handleSessionStart(api, args as Record<string, unknown> | undefined, sessionState);
    case 'session_save': {
      const v = validateArgs(SessionSaveSchema, args);
      if ('error' in v) return v.error;
      return handleSessionSave(api, v.data, sessionState);
    }
    case 'session_end':
      return handleSessionEnd(api, args as Record<string, unknown> | undefined, sessionState);
    case 'session_restore':
      return handleSessionRestore(api, args as Record<string, unknown> | undefined);
    case 'memory_feedback_auto': {
      const v = validateArgs(MemoryFeedbackAutoSchema, args);
      if ('error' in v) return v.error;
      return handleMemoryFeedbackAuto(api, v.data);
    }
    case 'memory_curate': {
      const v = validateArgs(MemoryCurateSchema, args);
      if ('error' in v) return v.error;
      return handleMemoryCurate(api, v.data);
    }
    case 'context_assemble': {
      const v = validateArgs(ContextAssembleSchema, args);
      if ('error' in v) return v.error;
      return handleContextAssemble(api, v.data);
    }
    case 'context_internalize': {
      const v = validateArgs(ContextInternalizeSchema, args);
      if ('error' in v) return v.error;
      return handleContextInternalize(api, v.data);
    }
    case 'memory_evolve': {
      const v = validateArgs(MemoryEvolveSchema, args);
      if ('error' in v) return v.error;
      return handleMemoryEvolve(api, v.data);
    }
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// Resources: list
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return { resources: RESOURCE_DEFINITIONS };
});

// Resources: read
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const content = await handleReadResource(api, request.params.uri);
  return { contents: [content] };
});

// ============================================================
// Start Server
// ============================================================

async function main() {
  await api.init();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  const mode = isTeamMode ? `team (${TEAM_SERVER_URL})` : 'local';
  logger.info({ mode }, 'Mindstrate MCP Server started');
}

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('Shutting down (SIGINT)');
  api.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  logger.info('Shutting down (SIGTERM)');
  api.close();
  process.exit(0);
});

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start MCP server');
  process.exit(1);
});
