/**
 * CLI Command: ctx
 *
 * 上下文策划 -- 为任务自动组装知识包。
 */

import { Command } from 'commander';
import { createMemory } from '../helpers.js';

export function registerCurateCommand(program: Command): void {
  program
    .command('ctx <task>')
    .description('为任务组装工作上下文')
    .option('-l, --language <lang>', '编程语言')
    .option('-f, --framework <fw>', '框架')
    .action(async (task, opts) => {
      const memory = createMemory();
      try {
        await memory.init();

        console.log(`Curating context for: "${task}"\n`);

        const curated = await memory.curateContext(task, {
          currentLanguage: opts.language,
          currentFramework: opts.framework,
        });

        console.log(curated.summary);

        console.log(`\n---\nKnowledge: ${curated.knowledge.length} | Workflows: ${curated.workflows.length} | Warnings: ${curated.warnings.length}`);
      } finally {
        memory.close();
      }
    });
}
