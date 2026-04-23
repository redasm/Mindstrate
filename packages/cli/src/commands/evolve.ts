/**
 * CLI Command: evolve
 *
 * 运行知识进化引擎。
 */

import { Command } from 'commander';
import { createMemory } from '../helpers.js';

export function registerEvolveCommand(program: Command): void {
  program
    .command('evolve')
    .description('运行知识进化引擎，分析并优化知识库')
    .option('--auto-apply', '自动应用低风险改进', false)
    .option('--max <n>', '最大分析数量', '100')
    .option('--mode <mode>', '运行模式：standard | background', 'standard')
    .action(async (opts) => {
      const memory = createMemory();
      try {
        await memory.init();

        console.log('Running knowledge evolution...\n');

        const result = await memory.runEvolution({
          autoApply: opts.autoApply,
          maxItems: parseInt(opts.max, 10),
          mode: opts.mode,
        });

        console.log(`Mode: ${result.mode}`);
        console.log(`Scanned: ${result.scanned} entries`);
        console.log(`Suggestions: ${result.suggestions.length}`);
        console.log(`Merge: ${result.summary.merge}`);
        console.log(`Improve: ${result.summary.improve}`);
        console.log(`Deprecate: ${result.summary.deprecate}`);
        console.log(`LLM enhanced: ${result.llmEnhanced}`);
        console.log(`Auto-applied: ${result.autoApplied}`);
        console.log(`Pending review: ${result.pendingReview}`);

        if (result.suggestions.length > 0) {
          console.log('\n--- Suggestions ---\n');
          for (const s of result.suggestions) {
            console.log(`[${s.type}] ${s.description}`);
            console.log(`   Knowledge: ${s.knowledgeId.substring(0, 8)}...`);
            console.log(`   Confidence: ${(s.confidence * 100).toFixed(0)}%`);
            console.log();
          }
        }
      } finally {
        memory.close();
      }
    });
}
