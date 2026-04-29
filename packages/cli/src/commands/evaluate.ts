/**
 * CLI Command: eval
 *
 * 运行检索质量评估。
 */

import { Command } from 'commander';
import { createMemory } from '../memory-factory.js';

export function registerEvaluateCommand(program: Command): void {
  program
    .command('eval')
    .description('运行检索质量评估')
    .option('--top-k <n>', '检索结果数量', '5')
    .option('--trend', '显示评估趋势', false)
    .action(async (opts) => {
      const memory = createMemory();
      try {
        await memory.init();

        if (opts.trend) {
          const trend = memory.evaluation.getEvalTrend(10);
          console.log(`Evaluation Trend: ${trend.trend}\n`);
          if (trend.runs.length === 0) {
            console.log('No evaluation runs yet. Run `mindstrate eval` first.');
          } else {
            console.log('Run ID      | Date       | Precision | Recall | F1    | MRR');
            console.log('------------|------------|-----------|--------|-------|------');
            for (const r of trend.runs) {
              const date = new Date(r.timestamp).toLocaleDateString('zh-CN');
              console.log(
                `${r.runId.substring(0, 11)} | ${date} | ${(r.precision * 100).toFixed(1)}%     | ${(r.recall * 100).toFixed(1)}%  | ${(r.f1 * 100).toFixed(1)}% | ${(r.mrr * 100).toFixed(1)}%`
              );
            }
          }
      } else {
        console.log('Running retrieval evaluation...\n');
        const result = await memory.evaluation.runEvaluation(parseInt(opts.topK, 10));
        const project = process.cwd().split(/[/\\]/).pop();

        if (result.totalCases === 0) {
          console.log('No evaluation cases found.');
          console.log('Use the addEvalCase API to add test cases for evaluation.');
        } else {
            console.log(`Cases: ${result.totalCases}`);
            console.log(`Precision: ${(result.precision * 100).toFixed(1)}%`);
            console.log(`Recall: ${(result.recall * 100).toFixed(1)}%`);
            console.log(`F1: ${(result.f1 * 100).toFixed(1)}%`);
            console.log(`MRR: ${(result.meanReciprocalRank * 100).toFixed(1)}%`);

            if (result.details.some(d => d.misses.length > 0)) {
              console.log('\n--- Misses ---');
              for (const d of result.details.filter(d => d.misses.length > 0)) {
                console.log(`Query: "${d.query}"`);
                console.log(`  Missing: ${d.misses.join(', ')}`);
            }
          }

          memory.events.ingestTestRun({
            content: `Retrieval evaluation completed. Cases=${result.totalCases}, precision=${(result.precision * 100).toFixed(1)}%, recall=${(result.recall * 100).toFixed(1)}%, f1=${(result.f1 * 100).toFixed(1)}%, mrr=${(result.meanReciprocalRank * 100).toFixed(1)}%`,
            project,
            actor: 'mindstrate-evaluate',
            sourceRef: `eval:${Date.now()}`,
            metadata: {
              totalCases: result.totalCases,
              precision: result.precision,
              recall: result.recall,
              f1: result.f1,
              mrr: result.meanReciprocalRank,
            },
          });
        }
      }
    } finally {
      memory.close();
    }
    });
}
