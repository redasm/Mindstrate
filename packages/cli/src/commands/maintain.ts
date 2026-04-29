/**
 * mindstrate doctor - 运行维护任务
 */

import { Command } from 'commander';
import { errorMessage } from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';

export const maintainCommand = new Command('doctor')
  .description('Run maintenance and health checks')
  .action(async () => {
    const memory = createMemory();

    try {
      await memory.init();
      console.log('Running maintenance tasks...\n');

      const result = memory.maintenance.runMaintenance();
      const evolution = await memory.metabolism.runEvolution({ mode: 'background', maxItems: 100 });

      console.log('Maintenance complete:\n');
      console.log(`  Total entries scanned: ${result.total}`);
      console.log(`  Entries updated:       ${result.updated}`);
      console.log(`  Entries outdated:      ${result.outdated}`);
      console.log('\nBackground evolution report:\n');
      console.log(`  Suggestions:           ${evolution.suggestions.length}`);
      console.log(`  Merge:                 ${evolution.summary.merge}`);
      console.log(`  Improve:               ${evolution.summary.improve}`);
      console.log(`  Archive:               ${evolution.summary.archive}`);
    } catch (error) {
      console.error('Maintenance failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
