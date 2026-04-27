/**
 * mindstrate doctor - 运行维护任务
 */

import { Command } from 'commander';
import { createMemory, errorMessage } from '../helpers.js';

export const maintainCommand = new Command('doctor')
  .description('Run maintenance and health checks')
  .action(async () => {
    const memory = createMemory();

    try {
      await memory.init();
      console.log('Running maintenance tasks...\n');

      const result = memory.runMaintenance();
      const evolution = await memory.runEvolution({ mode: 'background', maxItems: 100 });

      console.log('Maintenance complete:\n');
      console.log(`  Total entries scanned: ${result.total}`);
      console.log(`  Entries updated:       ${result.updated}`);
      console.log(`  Entries deprecated:    ${result.deprecated}`);
      console.log(`  Entries outdated:      ${result.outdated}`);
      console.log('\nBackground evolution report:\n');
      console.log(`  Suggestions:           ${evolution.suggestions.length}`);
      console.log(`  Merge:                 ${evolution.summary.merge}`);
      console.log(`  Improve:               ${evolution.summary.improve}`);
      console.log(`  Deprecate:             ${evolution.summary.deprecate}`);
    } catch (error) {
      console.error('Maintenance failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
