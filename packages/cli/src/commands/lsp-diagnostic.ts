/**
 * CLI Command: lsp-diagnostic
 *
 * Ingest an LSP diagnostic summary into the ECS event stream.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { createMemory } from '../helpers.js';

export const lspDiagnosticCommand = new Command('lsp-diagnostic')
  .description('Ingest an LSP diagnostic summary into the ECS event stream')
  .argument('[summary]', 'Short diagnostic summary')
  .option('-f, --file <path>', 'Read diagnostic summary from a file')
  .option('-p, --project <project>', 'Project scope (defaults to current directory name)')
  .option('-s, --session <sessionId>', 'Optional session id')
  .option('-r, --ref <sourceRef>', 'Source reference for linkage')
  .action(async (summary, options) => {
    const memory = createMemory();

    try {
      await memory.init();

      let content = (summary ?? '').trim();
      if (options.file) {
        content = fs.readFileSync(options.file, 'utf-8').trim();
      }

      if (!content) {
        console.error('Provide a summary argument or --file with diagnostic output.');
        process.exit(1);
      }

      const project = options.project || process.cwd().split(/[/\\]/).pop();
      const result = memory.ingestLspDiagnostic({
        content,
        project,
        sessionId: options.session,
        sourceRef: options.ref,
        metadata: {
          ingestedFrom: options.file ? 'file' : 'cli',
        },
      });

      console.log('LSP diagnostic ingested.');
      console.log(`  Event ID: ${result.event.id}`);
      console.log(`  Node ID:  ${result.node.id}`);
      if (project) {
        console.log(`  Project:  ${project}`);
      }
    } catch (error) {
      console.error('LSP diagnostic ingestion failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
