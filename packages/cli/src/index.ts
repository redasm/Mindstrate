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
 *   mindstrate delete <id>          删除知识
 *   mindstrate export [file]        导出知识库
 *   mindstrate import <file>        导入知识
 *   mindstrate mcp setup            生成 MCP Server 配置
 *   mindstrate web                  启动 Web UI 管理界面
 *   mindstrate doctor               运行维护任务
 *   mindstrate evolve               运行知识进化引擎
 *   mindstrate eval                 运行检索质量评估
 *   mindstrate ctx <task>           组装工作上下文
 *   mindstrate graph                查询 ECS 上下文图
 *   mindstrate conflict             查看 ECS 冲突记录
 *   mindstrate gc                   运行 ECS 代谢引擎
 *   mindstrate projection           导出 ECS 投影视图
 *   mindstrate bundle               管理可移植 ECS 上下文包
 *   mindstrate test                 写入测试结果到 ECS 事件流
 *   mindstrate diag                 写入诊断到 ECS 事件流
 *   mindstrate terminal             写入终端输出到 ECS 事件流
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { addCommand } from './commands/add.js';
import { searchCommand } from './commands/search.js';
import { listCommand } from './commands/list.js';
import { statsCommand } from './commands/stats.js';
import { maintainCommand } from './commands/maintain.js';
import { deleteCommand } from './commands/delete.js';
import { exportCommand, importCommand } from './commands/export-import.js';
import { setupMcpCommand } from './commands/setup-mcp.js';
import { webCommand } from './commands/web.js';
import { registerEvolveCommand } from './commands/evolve.js';
import { registerEvaluateCommand } from './commands/evaluate.js';
import { registerCurateCommand } from './commands/curate.js';
import { contextGraphCommand } from './commands/context-graph.js';
import { conflictsCommand } from './commands/conflicts.js';
import { metabolismCommand } from './commands/metabolism.js';
import { projectionCommand } from './commands/projection.js';
import { bundleCommand } from './commands/bundle.js';
import { lspDiagnosticCommand } from './commands/lsp-diagnostic.js';
import { testResultCommand } from './commands/test-result.js';
import { terminalOutputCommand } from './commands/terminal-output.js';
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
program.addCommand(deleteCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(setupMcpCommand);
program.addCommand(webCommand);
program.addCommand(maintainCommand);
program.addCommand(vaultCommand);
program.addCommand(contextGraphCommand);
program.addCommand(conflictsCommand);
program.addCommand(metabolismCommand);
program.addCommand(projectionCommand);
program.addCommand(bundleCommand);
program.addCommand(testResultCommand);
program.addCommand(terminalOutputCommand);
program.addCommand(lspDiagnosticCommand);
registerEvolveCommand(program);
registerEvaluateCommand(program);
registerCurateCommand(program);

program.parse();
