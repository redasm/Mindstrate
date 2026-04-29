/**
 * CLI Command: gc
 *
 * Run ECS metabolism and print the result.
 */

import { Command } from 'commander';
import { errorMessage } from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';

export const metabolismCommand = new Command('gc')
  .description('Run ECS garbage collection and compaction')
  .option('-p, --project <project>', 'Project scope')
  .option('-t, --trigger <trigger>', 'Trigger type: manual | scheduled | event_driven', 'manual')
  .option('-s, --stage <stage>', 'Run a single stage: digest | assimilate | compress | prune | reflect')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();

      if (options.stage) {
        const result = await runStage(memory, options.stage, options.project);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const run = await memory.metabolism.runMetabolism({
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
      console.error('Metabolism run failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

async function runStage(memory: ReturnType<typeof createMemory>, stage: string, project?: string) {
  switch (stage) {
    case 'digest':
      return memory.metabolism.runDigest({ project });
    case 'assimilate':
    case 'assimilation':
      return memory.metabolism.runAssimilation({ project });
    case 'compress':
    case 'compression':
      return memory.metabolism.runCompression({ project });
    case 'prune':
    case 'pruning':
      return memory.metabolism.runPruning({ project });
    case 'reflect':
    case 'reflection':
      return memory.metabolism.runReflection({ project });
    default:
      throw new Error(`Unknown metabolism stage: ${stage}`);
  }
}
