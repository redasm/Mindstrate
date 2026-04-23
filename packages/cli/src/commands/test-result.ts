/**
 * CLI Command: test-result
 *
 * Ingest a test result summary into the ECS event stream.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { createMemory } from '../helpers.js';

export const testResultCommand = new Command('test-result')
  .description('Ingest a test result summary into the ECS event stream')
  .argument('[summary]', 'Short test result summary')
  .option('-f, --file <path>', 'Read test output summary from a file')
  .option('-p, --project <project>', 'Project scope (defaults to current directory name)')
  .option('-s, --session <sessionId>', 'Optional session id')
  .option('-a, --actor <actor>', 'Actor label', 'test-runner')
  .option('-r, --ref <sourceRef>', 'Source reference for dedup/stream linkage')
  .action(async (summary, options) => {
    const memory = createMemory();

    try {
      await memory.init();

      let content = (summary ?? '').trim();
      if (options.file) {
        content = fs.readFileSync(options.file, 'utf-8').trim();
      }

      if (!content) {
        console.error('Provide a summary argument or --file with test output.');
        process.exit(1);
      }

      const project = options.project || process.cwd().split(/[/\\]/).pop();
      const result = memory.ingestTestRun({
        content,
        project,
        sessionId: options.session,
        actor: options.actor,
        sourceRef: options.ref,
        metadata: {
          ingestedFrom: options.file ? 'file' : 'cli',
        },
      });

      console.log('Test result ingested.');
      console.log(`  Event ID: ${result.event.id}`);
      console.log(`  Node ID:  ${result.node.id}`);
      if (project) {
        console.log(`  Project:  ${project}`);
      }
    } catch (error) {
      console.error('Test result ingestion failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
