/**
 * CLI Command: context-graph
 *
 * Query raw ECS context graph nodes.
 */

import { Command } from 'commander';
import { createMemory, truncate } from '../helpers.js';

export const contextGraphCommand = new Command('context-graph')
  .description('Query ECS context graph nodes')
  .option('-q, --query <query>', 'Lexical query over node title/content/tags')
  .option('-p, --project <project>', 'Project scope')
  .option('-s, --substrate <type>', 'Substrate type filter')
  .option('-d, --domain <type>', 'Domain type filter')
  .option('--status <status>', 'Status filter')
  .option('-l, --limit <number>', 'Maximum number of nodes', '10')
  .option('-v, --verbose', 'Show detailed content')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();

      const nodes = memory.queryContextGraph({
        query: options.query,
        project: options.project,
        substrateType: options.substrate,
        domainType: options.domain,
        status: options.status,
        limit: parseInt(options.limit, 10),
      });

      if (nodes.length === 0) {
        console.log('No ECS context nodes matched the query.');
        return;
      }

      console.log(`Found ${nodes.length} ECS context node(s):\n`);
      for (const node of nodes) {
        console.log(`[${node.substrateType}] ${node.title}`);
        console.log(`  Domain: ${node.domainType} | Status: ${node.status} | Quality: ${node.qualityScore.toFixed(0)}`);
        if (node.project) {
          console.log(`  Project: ${node.project}`);
        }
        if (node.tags.length > 0) {
          console.log(`  Tags: ${node.tags.join(', ')}`);
        }
        console.log(`  Content: ${options.verbose ? node.content : truncate(node.content, 120)}`);
        console.log(`  ID: ${node.id}`);
        console.log('');
      }
    } catch (error) {
      console.error('Context graph query failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      memory.close();
    }
  });
