/**
 * CLI Command: eval
 *
 * 运行检索质量评估。
 */

import { Command } from 'commander';
import { errorMessage, type EvalCaseKind } from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';

export function registerEvaluateCommand(program: Command): void {
  const evalCommand = program
    .command('eval')
    .description('运行检索质量评估')
    .option('--top-k <n>', '检索结果数量', '5')
    .option('--kind <kind>', '评估集类型：validation | holdout')
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
        const kind = opts.kind as EvalCaseKind | undefined;
        const result = await memory.evaluation.runEvaluation(
          parseInt(opts.topK, 10),
          kind ? { kind } : undefined,
        );
        const project = process.cwd().split(/[/\\]/).pop();

        if (result.totalCases === 0) {
          console.log('No evaluation cases found.');
          console.log('Use `mindstrate eval cases add` to add test cases for evaluation.');
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

  const cases = evalCommand
    .command('cases')
    .description('维护评估数据集（validation / holdout）');

  cases
    .command('list')
    .description('列出评估用例')
    .option('--kind <kind>', '过滤类型：validation | holdout')
    .action(async (opts: { kind?: string }) => {
      const memory = createMemory();
      try {
        await memory.init();
        const list = memory.evaluation.listEvalCases(opts.kind ? { kind: opts.kind as EvalCaseKind } : undefined);
        if (list.length === 0) {
          console.log('No eval cases found.');
          return;
        }
        for (const c of list) {
          console.log(`[${c.kind}] ${c.query} -> ${c.expectedIds.join(', ')}  (${c.id})`);
        }
      } catch (error) {
        console.error('Eval case list failed:', errorMessage(error));
        process.exit(1);
      } finally {
        memory.close();
      }
    });

  cases
    .command('add <query> <expectedIds...>')
    .description('添加评估用例（expectedIds 为期望命中的知识 id 列表）')
    .option('--kind <kind>', '类型：validation（默认）| holdout', 'validation')
    .option('--language <language>', '查询语言上下文')
    .option('--framework <framework>', '查询框架上下文')
    .action(async (query: string, expectedIds: string[], opts: { kind: string; language?: string; framework?: string }) => {
      const memory = createMemory();
      try {
        await memory.init();
        const created = memory.evaluation.addEvalCase(query, expectedIds, {
          kind: opts.kind as EvalCaseKind,
          language: opts.language,
          framework: opts.framework,
        });
        console.log(`Added ${created.kind} eval case ${created.id}.`);
      } catch (error) {
        console.error('Eval case add failed:', errorMessage(error));
        process.exit(1);
      } finally {
        memory.close();
      }
    });

  cases
    .command('generate')
    .description('从现有知识自动生成评估用例（自检索探针：查询=知识标题，期望=该知识 id）')
    .option('-p, --project <project>', '限定项目（默认全部）')
    .option('--limit <n>', '本次最多生成的用例数', '50')
    .option('--kind <kind>', '主分区类型：validation（默认）| holdout', 'validation')
    .option('--holdout-every <n>', '每第 N 条改写入 holdout 分区（0=关闭）', '0')
    .action(async (opts: { project?: string; limit: string; kind: string; holdoutEvery: string }) => {
      const memory = createMemory();
      try {
        await memory.init();
        const result = await memory.evaluation.generateEvalCases({
          project: opts.project,
          limit: parseInt(opts.limit, 10),
          kind: opts.kind as EvalCaseKind,
          holdoutEveryNth: parseInt(opts.holdoutEvery, 10) || 0,
        });
        console.log(
          `Generated ${result.created} eval case(s) `
          + `(${result.skippedExisting} already covered, ${result.consideredNodes} knowledge nodes considered).`,
        );
        if (result.created === 0 && result.consideredNodes === 0) {
          console.log('No projectable knowledge found. Ingest/scan a project first so the graph has knowledge to probe.');
        }
      } catch (error) {
        console.error('Eval case generate failed:', errorMessage(error));
        process.exit(1);
      } finally {
        memory.close();
      }
    });

  cases
    .command('delete <id>')
    .description('删除评估用例')
    .action(async (id: string) => {
      const memory = createMemory();
      try {
        await memory.init();
        const deleted = memory.evaluation.deleteEvalCase(id);
        console.log(deleted ? `Deleted eval case ${id}.` : `Eval case not found: ${id}`);
        if (!deleted) process.exit(1);
      } catch (error) {
        console.error('Eval case delete failed:', errorMessage(error));
        process.exit(1);
      } finally {
        memory.close();
      }
    });
}
