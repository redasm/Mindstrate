/**
 * mindstrate list - 列出知识
 */

import { Command } from 'commander';
import { KnowledgeType } from '@mindstrate/server';
import { createMemory, formatDate, truncate, TYPE_LABELS, STATUS_LABELS } from '../helpers.js';

export const listCommand = new Command('list')
  .description('List knowledge entries')
  .option('-n, --limit <number>', 'Max entries to show', '20')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --language <lang>', 'Filter by language')
  .action(async (options) => {
    const memory = createMemory();

    try {
      const entries = memory.list(
        {
          types: options.type ? [options.type as KnowledgeType] : undefined,
          language: options.language,
        },
        parseInt(options.limit, 10),
      );

      if (entries.length === 0) {
        console.log('No knowledge entries found.');
        console.log('Use "mindstrate add" to add your first entry.');
        return;
      }

      console.log(`Showing ${entries.length} knowledge entries:\n`);

      for (const k of entries) {
        const typeLabel = TYPE_LABELS[k.type] ?? k.type;
        const statusLabel = STATUS_LABELS[k.quality.status] ?? k.quality.status;

        console.log(`  [${typeLabel}] ${k.title}`);
        console.log(`  ID: ${k.id.substring(0, 8)}... | Score: ${k.quality.score.toFixed(0)} | ${statusLabel} | ${formatDate(k.metadata.createdAt)}`);
        console.log(`  ${truncate(k.solution, 100)}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to list:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
