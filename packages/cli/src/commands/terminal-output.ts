/**
 * CLI Command: terminal
 *
 * Ingest terminal or command output into the ECS event stream.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { createMemory, errorMessage } from '../helpers.js';

export const terminalOutputCommand = new Command('terminal')
  .description('Ingest terminal or command output into the ECS event stream')
  .argument('[output]', 'Terminal output summary')
  .option('-f, --file <path>', 'Read terminal output from a file')
  .option('-c, --command <command>', 'Command that produced the output')
  .option('-e, --exit-code <code>', 'Command exit code')
  .option('-p, --project <project>', 'Project scope (defaults to current directory name)')
  .option('-s, --session <sessionId>', 'Optional session id')
  .option('-a, --actor <actor>', 'Actor label', 'terminal')
  .option('-r, --ref <sourceRef>', 'Source reference for dedup/stream linkage')
  .action(async (output, options) => {
    const memory = createMemory();

    try {
      await memory.init();

      let content = (output ?? '').trim();
      if (options.file) {
        content = fs.readFileSync(options.file, 'utf-8').trim();
      }

      if (!content) {
        console.error('Provide output argument or --file with terminal output.');
        process.exit(1);
      }

      const exitCode = options.exitCode === undefined ? undefined : Number(options.exitCode);
      if (exitCode !== undefined && !Number.isFinite(exitCode)) {
        console.error('--exit-code must be a number.');
        process.exit(1);
      }

      const project = options.project || process.cwd().split(/[/\\]/).pop();
      const result = memory.ingestTerminalOutput({
        content,
        project,
        sessionId: options.session,
        actor: options.actor,
        command: options.command,
        exitCode,
        sourceRef: options.ref,
        metadata: {
          ingestedFrom: options.file ? 'file' : 'cli',
        },
      });

      console.log('Terminal output ingested.');
      console.log(`  Event ID: ${result.event.id}`);
      console.log(`  Node ID:  ${result.node.id}`);
      if (project) {
        console.log(`  Project:  ${project}`);
      }
    } catch (error) {
      console.error('Terminal output ingestion failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
