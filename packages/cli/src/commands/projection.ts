/**
 * CLI Command: projection
 *
 * Export ECS projection views to external editable formats.
 */

import * as path from 'node:path';
import { Command } from 'commander';
import { createMemory } from '../helpers.js';

export const projectionCommand = new Command('projection')
  .description('Export ECS projections');

projectionCommand
  .command('obsidian <path>')
  .description('Write verified ECS rules, heuristics, axioms, and skills as Obsidian markdown files')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <limit>', 'Maximum files to write', '100')
  .action(async (targetPath: string, options) => {
    const memory = createMemory();
    const rootDir = path.resolve(targetPath);

    try {
      await memory.init();
      const files = memory.writeObsidianProjectionFiles({
        rootDir,
        project: options.project,
        limit: Number(options.limit) || 100,
      });

      console.log(`Obsidian projection exported: ${rootDir}`);
      console.log(`  Files written: ${files.length}`);
      for (const file of files.slice(0, 20)) {
        console.log(`  - ${file}`);
      }
      if (files.length > 20) {
        console.log(`  ... ${files.length - 20} more`);
      }
    } catch (error) {
      console.error('Projection export failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
