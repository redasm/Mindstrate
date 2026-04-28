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
import pino from 'pino';

// Tool & Resource modules
import { TOOL_DEFINITIONS, toolByName } from './tools/tool-registry.js';
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
      const ok = await teamClient.admin.health();
      if (!ok) logger.warn({ url: TEAM_SERVER_URL }, 'Team Server is not reachable');
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

  async startSession(project: string, techContext?: string): Promise<{ session: Session; context: string | null }> {
    if (teamClient) {
      const result = await teamClient.sessions.start(project, techContext);
      return { session: result.session, context: result.context };
    }
    const session = await memory!.sessions.startSession({ project, techContext });
    const context = memory!.sessions.formatSessionContext(project);
    return { session, context: context || null };
  },

  async saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>) {
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

  async recordFeedback(retrievalId: string, signal: 'adopted' | 'rejected' | 'ignored' | 'partial', context?: string) {
    if (teamClient) return teamClient.feedback.record(retrievalId, signal, context);
    memory!.context.recordFeedback(retrievalId, signal, context);
  },

  async curateContext(task: string, context?: RetrievalContext): Promise<CuratedContext> {
    if (teamClient) return teamClient.context.curate(task, context);
    return memory!.assembly.curateContext(task, context);
  },

  async assembleContext(
    task: string,
    options?: { project?: string; context?: RetrievalContext; sessionId?: string },
  ) {
    if (teamClient) return teamClient.context.assemble(task, options);
    return memory!.assembly.assembleContext(task, options);
  },

  async runEvolution(options?: { autoApply?: boolean; maxItems?: number; mode?: 'standard' | 'background' }): Promise<EvolutionRunResult> {
    if (teamClient) return teamClient.admin.runEvolution(options);
    return memory!.metabolism.runEvolution(options);
  },

  async ingestContextEvent(input) {
    if (teamClient) return teamClient.context.ingestEvent(input);
    const result = memory!.events.ingestEvent(input as any);
    return { eventId: result.event.id, nodeId: result.node.id };
  },

  async queryContextGraph(options) {
    if (teamClient) return teamClient.context.queryGraph(options);
    return memory!.context.queryContextGraph(options as any);
  },

  async listContextEdges(options) {
    if (teamClient) return teamClient.context.listEdges(options);
    return memory!.context.listContextEdges(options as any);
  },

  async listContextConflicts(options) {
    if (teamClient) return teamClient.context.listConflicts(options);
    return memory!.context.listConflictRecords(options?.project, options?.limit);
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
    switch (stage) {
      case 'digest':
        return memory!.metabolism.runDigest(options);
      case 'assimilate':
        return memory!.metabolism.runAssimilation(options);
      case 'compress':
        return memory!.metabolism.runCompression(options);
      case 'prune':
        return memory!.metabolism.runPruning(options);
      case 'reflect':
        return memory!.metabolism.runReflection(options);
    }
  },

  async createBundle(options) {
    if (teamClient) return teamClient.bundles.create(options);
    return memory!.bundles.createBundle(options);
  },

  async validateBundle(bundle) {
    if (teamClient) return teamClient.bundles.validate(bundle);
    return memory!.bundles.validateBundle(bundle);
  },

  async installBundle(bundle) {
    if (teamClient) return teamClient.bundles.install(bundle);
    return memory!.bundles.installBundle(bundle);
  },

  async installBundleFromRegistry(options) {
    if (teamClient) return teamClient.bundles.installFromRegistry(options);
    return memory!.bundles.installBundleFromRegistry(options);
  },

  async publishBundle(bundle, options) {
    if (teamClient) return teamClient.bundles.publish(bundle, options);
    return memory!.bundles.publishBundle(bundle, options);
  },

  async generateInternalizationSuggestions(options) {
    if (teamClient) return teamClient.bundles.generateInternalizationSuggestions(options);
    return memory!.projections.generateInternalizationSuggestions(options);
  },

  async acceptInternalizationSuggestions(options) {
    if (teamClient) return teamClient.bundles.acceptInternalizationSuggestions(options);
    return memory!.projections.acceptInternalizationSuggestions(options as any);
  },

  async writeObsidianProjectionFiles(options) {
    if (teamClient) return teamClient.context.writeObsidianProjectionFiles(options);
    return { files: memory!.projections.writeObsidianProjectionFiles(options) };
  },

  async importObsidianProjectionFile(filePath) {
    if (teamClient) return teamClient.context.importObsidianProjectionFile(filePath);
    return memory!.projections.importObsidianProjectionFile(filePath);
  },

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
  const tool = toolByName.get(name);

  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    logger.warn({ tool: name, issues, args }, 'MCP tool input validation failed');
    return {
      content: [{ type: 'text', text: `Invalid input: ${issues}` }],
      isError: true,
    };
  }

  return (tool.handler as (toolApi: McpApi, input: unknown, state: SessionState) => Promise<any>)(
    api,
    parsed.data,
    sessionState,
  );
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
