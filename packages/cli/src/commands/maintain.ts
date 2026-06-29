/**
 * mindstrate doctor - 运行维护任务
 */

import { Command } from 'commander';
import { errorMessage } from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';

export const maintainCommand = new Command('doctor')
  .description('Run maintenance and health checks')
  .option('--rebuild-vectors', 'Re-embed all node embeddings (fixes embedding-model/dimension drift)')
  .option('--prune-template-knowledge', 'Delete template-placeholder compression nodes (pseudo summary/pattern/rule/skill) left before LLM synthesis was required')
  .option('-p, --project <name>', 'Limit --rebuild-vectors / --prune-template-knowledge to a single project')
  .action(async (options) => {
    const memory = createMemory();

    try {
      await memory.init();

      if (options.rebuildVectors) {
        console.log('Rebuilding node embeddings...\n');
        const results = await memory.maintenance.rebuildVectors(options.project);
        if (results.length === 0) {
          console.log('No projects found to rebuild.');
        }
        for (const result of results) {
          console.log(
            `  ${result.project}: ${result.embedded}/${result.candidates} nodes embedded `
              + `(${result.model}, ${result.dimensions}d)`,
          );
        }
        console.log('\nNode embeddings rebuilt.');
        return;
      }

      if (options.pruneTemplateKnowledge) {
        console.log('Pruning template-placeholder compression nodes...\n');
        const mid = memory.maintenance.pruneTemplateCompressedNodes(options.project);
        const high = memory.maintenance.pruneTemplateHighOrderNodes(options.project);
        console.log(`  Mid-tier (summary/pattern/rule): ${mid.nodesDeleted} deleted`);
        console.log(`  High-order (skill/heuristic/axiom): ${high.nodesDeleted} deleted`);
        console.log(`\nTotal: ${mid.nodesDeleted + high.nodesDeleted} template node(s) pruned.`);
        return;
      }

      console.log('Running maintenance tasks...\n');

      const result = memory.maintenance.runMaintenance();
      const evolution = await memory.metabolism.runEvolution({ mode: 'background', maxItems: 100 });

      console.log('Maintenance complete:\n');
      console.log(`  Total entries scanned: ${result.total}`);
      console.log(`  Entries updated:       ${result.updated}`);
      console.log(`  Entries outdated:      ${result.outdated}`);
      console.log('\nBackground evolution report:\n');
      console.log(`  Suggestions:           ${evolution.suggestions.length}`);
      console.log(`  Merge:                 ${evolution.summary.merge}`);
      console.log(`  Improve:               ${evolution.summary.improve}`);
      console.log(`  Archive:               ${evolution.summary.archive}`);
    } catch (error) {
      console.error('Maintenance failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
