/**
 * CLI Command: projection
 *
 * Export ECS projection views to external editable formats.
 */

import * as path from 'node:path';
import { Command } from 'commander';
import { errorMessage } from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';
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
  .command('sessions')
  .description('Materialize ECS session snapshots as session summary projection records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <limit>', 'Maximum records to materialize', '100')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const records = memory.projections.projectSessionSummaries({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      printProjectionRecords('Session projection', records);
    } catch (error) {
      console.error('Session projection failed:', errorMessage(error));
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
      const records = memory.projections.projectProjectSnapshots({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      printProjectionRecords('Project snapshot projection', records);
    } catch (error) {
      console.error('Project snapshot projection failed:', errorMessage(error));
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
      const records = memory.projections.projectObsidianDocuments({
        project: options.project,
        limit: Number(options.limit) || 100,
      });
      const files = memory.projections.writeObsidianProjectionFiles({
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
      console.error('Projection export failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

projectionCommand
  .command('import-obsidian <file>')
  .description('Import an edited ECS Obsidian projection markdown file as a candidate node')
  .action(async (filePath: string) => {
    const memory = createMemory();

    try {
      await memory.init();
      const result = memory.projections.importObsidianProjectionFile(path.resolve(filePath));
      if (!result.changed) {
        console.log('No ECS projection changes imported.');
        return;
      }
      console.log('Obsidian projection edit imported.');
      console.log(`  Source node: ${result.sourceNodeId}`);
      console.log(`  Candidate:   ${result.candidateNode?.id}`);
      console.log(`  Event:       ${result.event?.id}`);
    } catch (error) {
      console.error('Projection import failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
