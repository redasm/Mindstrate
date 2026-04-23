/**
 * CLI Command: conflicts
 *
 * List ECS conflict records.
 */

import { Command } from 'commander';
import { createMemory, formatDate } from '../helpers.js';

export const conflictsCommand = new Command('conflicts')
  .description('List ECS conflict records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of conflicts', '20')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();

      const conflicts = memory.listConflictRecords(
        options.project,
        parseInt(options.limit, 10),
      );

      if (conflicts.length === 0) {
        console.log('No ECS conflicts found.');
        return;
      }

      console.log(`Found ${conflicts.length} ECS conflict record(s):\n`);
      for (const conflict of conflicts) {
        console.log(`${conflict.reason}`);
        if (conflict.project) {
          console.log(`  Project: ${conflict.project}`);
        }
        console.log(`  Nodes: ${conflict.nodeIds.join(', ')}`);
        console.log(`  Detected: ${formatDate(conflict.detectedAt)}`);
        if (conflict.resolvedAt) {
          console.log(`  Resolved: ${formatDate(conflict.resolvedAt)}`);
        }
        if (conflict.resolution) {
          console.log(`  Resolution: ${conflict.resolution}`);
        }
        console.log(`  ID: ${conflict.id}`);
        console.log('');
      }
    } catch (error) {
      console.error('Conflict query failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
