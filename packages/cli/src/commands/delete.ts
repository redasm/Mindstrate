/**
 * mindstrate delete - 删除知识
 */

import { Command } from 'commander';
import { createMemory, findKnowledge } from '../helpers.js';

export const deleteCommand = new Command('delete')
  .description('Delete a knowledge entry')
  .argument('<id>', 'Knowledge entry ID (full or partial)')
  .option('-f, --force', 'Skip confirmation', false)
  .action(async (id, options) => {
    const memory = createMemory();

    try {
      await memory.init();

      // 支持部分 ID 匹配
      const knowledge = findKnowledge(memory, id);

      if (!knowledge) {
        console.error(`Knowledge not found: ${id}`);
        process.exit(1);
      }

      if (!options.force) {
        console.log(`About to delete:`);
        console.log(`  Title: ${knowledge.title}`);
        console.log(`  ID:    ${knowledge.id}`);
        console.log(`\nUse --force to skip this confirmation.`);

        // 简单的 stdin 确认
        const readline = await import('node:readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const answer = await new Promise<string>(resolve => {
          rl.question('  Continue? (y/N) ', resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== 'y') {
          console.log('Cancelled.');
          return;
        }
      }

      const deleted = await memory.delete(knowledge.id);
      if (deleted) {
        console.log(`Deleted: ${knowledge.title}`);
      } else {
        console.error('Failed to delete.');
      }
    } catch (error) {
      console.error('Delete failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
