/**
 * CLI Command: gc
 *
 * Run ECS metabolism and print the result.
 */

import { Command } from 'commander';
import { createMemory } from '../helpers.js';

export const metabolismCommand = new Command('gc')
  .description('Run ECS garbage collection and compaction')
  .option('-p, --project <project>', 'Project scope')
  .option('-t, --trigger <trigger>', 'Trigger type: manual | scheduled | event_driven', 'manual')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();

      const run = await memory.runMetabolism({
        project: options.project,
        trigger: options.trigger,
      });

      console.log('ECS Metabolism Run\n');
      console.log(`  Run ID:  ${run.id}`);
      console.log(`  Status:  ${run.status}`);
      console.log(`  Trigger: ${run.trigger}`);
      if (run.project) {
        console.log(`  Project: ${run.project}`);
      }

      const stageEntries = Object.entries(run.stageStats);
      if (stageEntries.length > 0) {
        console.log('\n  Stage Stats:');
        for (const [stage, stat] of stageEntries) {
          console.log(`    ${stage}: scanned=${stat?.scanned ?? 0}, created=${stat?.created ?? 0}, updated=${stat?.updated ?? 0}, skipped=${stat?.skipped ?? 0}`);
        }
      }

      if ((run.notes?.length ?? 0) > 0) {
        console.log('\n  Notes:');
        for (const note of run.notes ?? []) {
          console.log(`    - ${note}`);
        }
      }
    } catch (error) {
      console.error('Metabolism run failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
