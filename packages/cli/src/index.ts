#!/usr/bin/env node

/**
 * Mindstrate CLI - Entry Point
 *
 * Usage:
 *   mindstrate init                 初始化 Mindstrate
 *   mindstrate add                  添加一条知识
 *   mindstrate search <query>       搜索相关知识
 *   mindstrate list                 列出知识
 *   mindstrate stats                查看统计信息
 *   mindstrate vote <id> <up|down>  投票
 *   mindstrate delete <id>          删除知识
 *   mindstrate capture              从 git commit 采集知识
 *   mindstrate hook install         安装 git hook
 *   mindstrate hook uninstall       卸载 git hook
 *   mindstrate export [file]        导出知识库
 *   mindstrate import <file>        导入知识
 *   mindstrate setup-mcp            生成 MCP Server 配置
 *   mindstrate web                  启动 Web UI 管理界面
 *   mindstrate maintain             运行维护任务
 *   mindstrate evolve               运行知识进化引擎
 *   mindstrate evaluate             运行检索质量评估
 *   mindstrate curate <task>        上下文策划
 *   mindstrate context-graph        查询 ECS 上下文图
 *   mindstrate conflicts            查看 ECS 冲突记录
 *   mindstrate metabolism           运行 ECS 代谢引擎
 *   mindstrate bundle               管理可移植 ECS 上下文包
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { searchCommand } from './commands/search.js';
import { listCommand } from './commands/list.js';
import { statsCommand } from './commands/stats.js';
import { maintainCommand } from './commands/maintain.js';
import { voteCommand } from './commands/vote.js';
import { deleteCommand } from './commands/delete.js';
import { captureCommand } from './commands/capture.js';
import { hookCommand } from './commands/hook.js';
import { exportCommand, importCommand } from './commands/export-import.js';
import { setupMcpCommand } from './commands/setup-mcp.js';
import { webCommand } from './commands/web.js';
import { registerEvolveCommand } from './commands/evolve.js';
import { registerEvaluateCommand } from './commands/evaluate.js';
import { registerCurateCommand } from './commands/curate.js';
import { contextGraphCommand } from './commands/context-graph.js';
import { conflictsCommand } from './commands/conflicts.js';
import { metabolismCommand } from './commands/metabolism.js';
import { bundleCommand } from './commands/bundle.js';
import { vaultCommand } from './commands/vault.js';

const program = new Command();

program
  .name('mindstrate')
  .description('Mindstrate - AI memory and context substrate for agents and teams')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(searchCommand);
program.addCommand(listCommand);
program.addCommand(statsCommand);
program.addCommand(voteCommand);
program.addCommand(deleteCommand);
program.addCommand(captureCommand);
program.addCommand(hookCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(setupMcpCommand);
program.addCommand(webCommand);
program.addCommand(maintainCommand);
program.addCommand(vaultCommand);
program.addCommand(contextGraphCommand);
program.addCommand(conflictsCommand);
program.addCommand(metabolismCommand);
program.addCommand(bundleCommand);
registerEvolveCommand(program);
registerEvaluateCommand(program);
registerCurateCommand(program);

program.parse();
