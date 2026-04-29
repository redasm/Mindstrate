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
import pino from 'pino';

import { TOOL_DEFINITIONS, toolByName } from './tools/tool-registry.js';
import { RESOURCE_DEFINITIONS, handleReadResource } from './resources/handlers.js';
import { createMcpApi } from './mcp-runtime-api.js';
import type { McpApi, SessionState } from './types.js';

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

// Optional Obsidian vault sync (local mode only)
const OBSIDIAN_VAULT_PATH = process.env['OBSIDIAN_VAULT_PATH'] ?? '';
const OBSIDIAN_AUTO_SYNC = process.env['OBSIDIAN_AUTO_SYNC'] !== 'false';
const OBSIDIAN_WATCH = process.env['OBSIDIAN_WATCH'] === 'true';

// 追踪当前活跃会话
const sessionState: SessionState = {
  currentSessionId: null,
  currentSessionProject: '',
};

// ============================================================
// Unified API — abstracts local/team differences
// ============================================================

const api: McpApi = createMcpApi({
  teamServerUrl: TEAM_SERVER_URL,
  teamApiKey: TEAM_API_KEY,
  obsidianVaultPath: OBSIDIAN_VAULT_PATH,
  obsidianAutoSync: OBSIDIAN_AUTO_SYNC,
  obsidianWatch: OBSIDIAN_WATCH,
  logger,
});

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
