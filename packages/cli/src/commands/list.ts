/**
 * mindstrate list - 列出知识
 */

import { Command } from 'commander';
import { createMemory, errorMessage, truncate, TYPE_LABELS, STATUS_LABELS } from '../helpers.js';

export const listCommand = new Command('list')
  .description('List knowledge entries')
  .option('-n, --limit <number>', 'Max entries to show', '20')
  .option('-t, --type <type>', 'Filter by type')
  .option('-l, --language <lang>', 'Filter by language')
  .action(async (options) => {
    const memory = createMemory();

    try {
      const entries = memory.context.readGraphKnowledge({ limit: 100000 })
        .filter((entry) => !options.type || entry.domainType === options.type)
        .filter((entry) => !options.language || entry.tags.includes(options.language))
        .slice(0, parseInt(options.limit, 10));

      if (entries.length === 0) {
        console.log('No knowledge entries found.');
        console.log('Use "mindstrate add" to add your first entry.');
        return;
      }

      console.log(`Showing ${entries.length} knowledge entries:\n`);

      for (const k of entries) {
        const typeLabel = TYPE_LABELS[k.domainType] ?? k.domainType;
        const statusLabel = STATUS_LABELS[k.status] ?? k.status;

        console.log(`  [${typeLabel}] ${k.title}`);
        console.log(`  ID: ${k.id.substring(0, 8)}... | Priority: ${k.priorityScore.toFixed(2)} | ${k.substrateType} | ${statusLabel}`);
        console.log(`  ${truncate(k.summary, 100)}`);
        console.log('');
      }
    } catch (error) {
      console.error('Failed to list:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
