/**
 * CLI Command: projection
 *
 * Export ECS projection views to external editable formats.
 */

import * as path from 'node:path';
import { Command } from 'commander';
import { createMemory } from '../helpers.js';
import type { ProjectionRecord } from '@mindstrate/protocol/models';

export const projectionCommand = new Command('projection')
  .description('Materialize and export ECS projections');

const printProjectionRecords = (label: string, records: ProjectionRecord[]): void => {
  console.log(`${label} materialized.`);
  console.log(`  Records: ${records.length}`);
  for (const record of records.slice(0, 20)) {
    console.log(`  - ${record.targetRef} (${record.nodeId})`);
  }
  if (records.length > 20) {
    console.log(`  ... ${records.length - 20} more`);
  }
};

projectionCommand
  .command('knowledge')
  .description('Materialize graph knowledge views as legacy KnowledgeUnit projection records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <limit>', 'Maximum records to materialize', '100')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const records = memory.projectKnowledgeUnit({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      printProjectionRecords('Knowledge projection', records);
    } catch (error) {
      console.error('Knowledge projection failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

projectionCommand
  .command('sessions')
  .description('Materialize ECS session snapshots as session summary projection records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <limit>', 'Maximum records to materialize', '100')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const records = memory.projectSessionSummaries({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      printProjectionRecords('Session projection', records);
    } catch (error) {
      console.error('Session projection failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

projectionCommand
  .command('project-snapshots')
  .description('Materialize ECS project snapshots as project snapshot projection records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <limit>', 'Maximum records to materialize', '100')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const records = memory.projectProjectSnapshots({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      printProjectionRecords('Project snapshot projection', records);
    } catch (error) {
      console.error('Project snapshot projection failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

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
      const records = memory.projectObsidianDocuments({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      const files = memory.writeObsidianProjectionFiles({
        rootDir,
        project: options.project,
        limit: Number(options.limit) || 100,
      });

      console.log(`Obsidian projection exported: ${rootDir}`);
      console.log(`  Projection records: ${records.length}`);
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
