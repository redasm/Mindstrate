/**
 * mindstrate setup-mcp - 生成 MCP Server 配置
 *
 * 为不同的 AI 编程工具生成接入配置：
 * - Cursor: .cursor/mcp.json
 * - OpenCode: opencode.json
 * - Claude Desktop: claude_desktop_config.json
 */

import { Command } from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface SetupMcpResult {
  generated: string[];
  serverPath: string;
}

/**
 * Programmatic entry: write MCP config(s) for the requested tool(s).
 * Used both by `mindstrate setup-mcp` and by `mindstrate init --tool ...`.
 */
export function writeMcpConfig(options: {
  tool: 'cursor' | 'opencode' | 'claude-desktop' | 'all';
  cwd?: string;
  global?: boolean;
  /** Extra environment variables to inject into every generated MCP entry. */
  extraEnv?: Record<string, string>;
}): SetupMcpResult {
  const cwd = options.cwd ?? process.cwd();
  const serverPath = findServerPath();
  if (!serverPath) {
    throw new Error(
      'Cannot find @mindstrate/mcp-server build output. Run `npm run build` first.',
    );
  }

  const nodePath = process.execPath;
  const tool = options.tool;
  const generated: string[] = [];

  const baseEnv: Record<string, string> = {
    MINDSTRATE_DATA_DIR: path.join(cwd, '.mindstrate'),
    ...(options.extraEnv ?? {}),
  };

  // Cursor
  if (tool === 'cursor' || tool === 'all') {
    const cursorDir = path.join(cwd, '.cursor');
    if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
    const cursorPath = path.join(cursorDir, 'mcp.json');
    const existing = readJsonOrEmpty(cursorPath);
    existing.mcpServers = {
      ...(existing.mcpServers ?? {}),
      'mindstrate': {
        command: nodePath,
        args: [serverPath],
        env: baseEnv,
      },
    };
    fs.writeFileSync(cursorPath, JSON.stringify(existing, null, 2));
    generated.push(`Cursor:         ${cursorPath}`);
  }

  // OpenCode
  if (tool === 'opencode' || tool === 'all') {
    const opencodePath = path.join(cwd, 'opencode.json');
    const existing = readJsonOrEmpty(opencodePath);
    existing.mcp = {
      ...(existing.mcp ?? {}),
      'mindstrate': {
        type: 'local',
        command: nodePath,
        args: [serverPath],
        env: baseEnv,
      },
    };
    fs.writeFileSync(opencodePath, JSON.stringify(existing, null, 2));
    generated.push(`OpenCode:       ${opencodePath}`);
  }

  // Claude Desktop
  if (tool === 'claude-desktop' || tool === 'all') {
    const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
    const claudeDir = process.platform === 'win32'
      ? path.join(homeDir, 'AppData', 'Roaming', 'Claude')
      : path.join(homeDir, 'Library', 'Application Support', 'Claude');

    if (options.global && fs.existsSync(claudeDir)) {
      const claudePath = path.join(claudeDir, 'claude_desktop_config.json');
      const existing = readJsonOrEmpty(claudePath);
      existing.mcpServers = {
        ...(existing.mcpServers ?? {}),
        'mindstrate': {
          command: nodePath,
          args: [serverPath],
          env: baseEnv,
        },
      };
      fs.writeFileSync(claudePath, JSON.stringify(existing, null, 2));
      generated.push(`Claude Desktop: ${claudePath}`);
    } else {
      const claudePath = path.join(cwd, 'claude_desktop_config.json');
      const config = {
        mcpServers: {
          'mindstrate': {
            command: nodePath,
            args: [serverPath],
            env: baseEnv,
          },
        },
      };
      fs.writeFileSync(claudePath, JSON.stringify(config, null, 2));
      generated.push(`Claude Desktop: ${claudePath} (copy to Claude config dir)`);
    }
  }

  return { generated, serverPath };
}

export const setupMcpCommand = new Command('setup-mcp')
  .description('Generate MCP server config for AI coding assistants')
  .option('--tool <tool>', 'Target tool: cursor, opencode, claude-desktop, all', 'all')
  .option('--global', 'Install globally (Claude Desktop)', false)
  .action((options) => {
    try {
      const { generated, serverPath } = writeMcpConfig({
        tool: options.tool,
        global: options.global,
      });
      console.log('MCP Server config generated:\n');
      for (const g of generated) console.log(`  ${g}`);
      console.log(`\nServer: ${serverPath}`);
      console.log('\nThe AI assistant will now have access to:');
      console.log('  - memory_search: Search team knowledge base');
      console.log('  - memory_add:    Save new knowledge');
      console.log('  - memory_feedback: Upvote/downvote knowledge');
    } catch (err) {
      console.error('Error:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

function readJsonOrEmpty(p: string): any {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch { return {}; }
}

function findServerPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../mcp-server/dist/server.js'),
    path.resolve(process.cwd(), 'packages/mcp-server/dist/server.js'),
    path.resolve(process.cwd(), 'node_modules/@mindstrate/mcp-server/dist/server.js'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
