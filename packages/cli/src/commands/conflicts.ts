/**
 * CLI Command: conflict
 *
 * List ECS conflict records.
 */

import { Command } from 'commander';
import { createMemory, formatDate } from '../helpers.js';

const listConflicts = async (options: { project?: string; limit: string }): Promise<void> => {
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
};

export const conflictsCommand = new Command('conflict')
  .description('List and resolve ECS conflict records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of conflicts', '20')
  .action(listConflicts);

conflictsCommand
  .command('list')
  .description('List ECS conflict records')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of conflicts', '20')
  .action(listConflicts);

conflictsCommand
  .command('accept <conflictId> <candidateNodeId>')
  .description('Accept a reflection candidate and resolve the source conflict')
  .requiredOption('-r, --resolution <text>', 'Resolution note')
  .action(async (conflictId: string, candidateNodeId: string, options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const result = memory.acceptConflictCandidate({
        conflictId,
        candidateNodeId,
        resolution: options.resolution,
      });
      if (!result.resolved) {
        console.error('Conflict candidate was not accepted.');
        process.exit(1);
      }
      console.log('Conflict resolved.');
      console.log(`  ID: ${result.resolved.id}`);
      console.log(`  Resolution: ${result.resolved.resolution}`);
    } catch (error) {
      console.error('Conflict accept failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });

conflictsCommand
  .command('reject <conflictId> <candidateNodeId>')
  .description('Reject a reflection candidate without resolving the source conflict')
  .requiredOption('--reason <text>', 'Rejection reason')
  .action(async (conflictId: string, candidateNodeId: string, options) => {
    const memory = createMemory();

    try {
      await memory.init();
      const result = memory.rejectConflictCandidate({
        conflictId,
        candidateNodeId,
        reason: options.reason,
      });
      if (!result.rejectedNode) {
        console.error('Conflict candidate was not rejected.');
        process.exit(1);
      }
      console.log('Conflict candidate rejected.');
      console.log(`  Conflict: ${conflictId}`);
      console.log(`  Candidate: ${candidateNodeId}`);
    } catch (error) {
      console.error('Conflict reject failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
