/**
 * mindstrate search <query> - 搜索知识库
 */

import { Command } from 'commander';
import { KnowledgeType } from '@mindstrate/server';
import { createMemory, formatDate, truncate, TYPE_LABELS, STATUS_LABELS } from '../helpers.js';

export const searchCommand = new Command('search')
  .description('Search the knowledge base')
  .argument('<query>', 'Search query')
  .option('-k, --top-k <number>', 'Number of results', '5')
  .option('-t, --type <type>', 'Filter by knowledge type')
  .option('-l, --language <lang>', 'Filter by programming language')
  .option('-f, --framework <fw>', 'Filter by framework')
  .option('--min-score <score>', 'Minimum quality score', '0')
  .option('-v, --verbose', 'Show detailed results')
  .action(async (query, options) => {
    const memory = createMemory();

    try {
      await memory.init();

      const results = await memory.search(query, {
        topK: parseInt(options.topK, 10),
        filter: {
          types: options.type ? [options.type as KnowledgeType] : undefined,
          language: options.language,
          framework: options.framework,
          minScore: parseFloat(options.minScore),
        },
      });

      if (results.length === 0) {
        console.log('No results found.\n');
        console.log('Tips:');
        console.log('  - Try a different query');
        console.log('  - Use "mindstrate add" to add knowledge first');
        console.log('  - Remove filters to broaden the search');
        return;
      }

      console.log(`Found ${results.length} result(s) for "${query}":\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const k = r.knowledge;
        const typeLabel = TYPE_LABELS[k.type] ?? k.type;
        const statusLabel = STATUS_LABELS[k.quality.status] ?? k.quality.status;

        console.log(`  ${i + 1}. [${typeLabel}] ${k.title}`);
        console.log(`     Relevance: ${(r.relevanceScore * 100).toFixed(1)}% | Score: ${k.quality.score.toFixed(0)} | Status: ${statusLabel}`);

        if (k.problem) {
          console.log(`     Problem:  ${truncate(k.problem, 80)}`);
        }
        console.log(`     Solution: ${truncate(k.solution, 80)}`);

        if (k.tags.length > 0) {
          console.log(`     Tags: ${k.tags.join(', ')}`);
        }

        if (options.verbose) {
          console.log(`     ID: ${k.id}`);
          console.log(`     Author: ${k.metadata.author} | Created: ${formatDate(k.metadata.createdAt)}`);
          console.log(`     Used: ${k.quality.useCount} times`);
          if (r.matchReason) {
            console.log(`     Match: ${r.matchReason}`);
          }
        }

        console.log('');
      }
    } catch (error) {
      console.error('Search failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
