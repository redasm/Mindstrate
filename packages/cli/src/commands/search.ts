/**
 * mindstrate search <query> - 搜索知识库
 */

import { Command } from 'commander';
import { createMemory, truncate, TYPE_LABELS, STATUS_LABELS } from '../helpers.js';

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

      const minScore = parseFloat(options.minScore);
      const results = memory.queryGraphKnowledge(query, {
        topK: parseInt(options.topK, 10),
        limit: 100,
      }).filter((result) => !options.type || result.view.domainType === options.type)
        .filter((result) => !options.language || result.view.tags.includes(options.language))
        .filter((result) => !options.framework || result.view.tags.includes(options.framework))
        .filter((result) => Number.isNaN(minScore) || result.view.priorityScore >= minScore);

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
        const k = r.view;
        const typeLabel = TYPE_LABELS[k.domainType] ?? k.domainType;
        const statusLabel = STATUS_LABELS[k.status] ?? k.status;

        console.log(`  ${i + 1}. [${typeLabel}] ${k.title}`);
        console.log(`     Relevance: ${(r.relevanceScore * 100).toFixed(1)}% | Priority: ${k.priorityScore.toFixed(2)} | Status: ${statusLabel}`);

        console.log(`     Summary: ${truncate(k.summary, 80)}`);

        if (k.tags.length > 0) {
          console.log(`     Tags: ${k.tags.join(', ')}`);
        }

        if (options.verbose) {
          console.log(`     ID: ${k.id}`);
          console.log(`     Substrate: ${k.substrateType} | Domain: ${k.domainType}`);
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
