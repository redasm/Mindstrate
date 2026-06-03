/**
 * CLI Command: skill
 *
 * Review SkillOpt-style skill evolution candidate patches: list pending
 * candidates, inspect a patch diff, run the validation gate, or reject a
 * patch with an audited reason.
 */

import { Command } from 'commander';
import {
  errorMessage,
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
  type SkillEvolutionPatchStatus,
} from '@mindstrate/server';
import { createMemory } from '../memory-factory.js';
import { formatDate } from '../i18n-zh.js';

export const skillEvolutionCommand = new Command('skill')
  .description('Review and gate skill evolution candidate patches');

skillEvolutionCommand
  .command('list')
  .description('List skill evolution candidate patches')
  .option('-p, --project <project>', 'Project scope')
  .option('-s, --status <status>', 'Filter by status: candidate, accepted, rejected')
  .option('-l, --limit <number>', 'Maximum number of patches', '20')
  .action(async (options: { project?: string; status?: string; limit: string }) => {
    const memory = createMemory();
    try {
      await memory.init();
      const patches = memory.metabolism.listSkillPatches({
        project: options.project,
        status: options.status as SkillEvolutionPatchStatus | undefined,
        limit: parseInt(options.limit, 10),
      });

      if (patches.length === 0) {
        console.log('No skill evolution patches found.');
        return;
      }

      console.log(`Found ${patches.length} skill evolution patch(es):\n`);
      for (const patch of patches) {
        console.log(`[${patch.status}] ${patch.operation} on ${patch.sourceNodeId}`);
        if (patch.project) console.log(`  Project: ${patch.project}`);
        console.log(`  Rationale: ${patch.rationale}`);
        console.log(`  Created: ${formatDate(patch.createdAt)}`);
        console.log(`  ID: ${patch.id}`);
        console.log('');
      }
    } catch (error) {
      console.error('Skill patch list failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

skillEvolutionCommand
  .command('show <patchId>')
  .description('Show a skill evolution patch with before/after content')
  .action(async (patchId: string) => {
    const memory = createMemory();
    try {
      await memory.init();
      const patch = memory.metabolism.getSkillPatch(patchId);
      if (!patch) {
        console.error(`Patch not found: ${patchId}`);
        process.exit(1);
        return;
      }
      console.log(`Patch ${patch.id} [${patch.status}]`);
      console.log(`  Source node: ${patch.sourceNodeId}`);
      console.log(`  Operation: ${patch.operation}`);
      console.log(`  Rationale: ${patch.rationale}`);
      console.log(`  Budget: maxChangedBullets=${patch.budget.maxChangedBullets}, maxChangedTokens=${patch.budget.maxChangedTokens}`);
      console.log('\n--- Before ---');
      console.log(patch.beforeContent);
      console.log('\n--- After ---');
      console.log(patch.afterContent);
    } catch (error) {
      console.error('Skill patch show failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

skillEvolutionCommand
  .command('evaluate <patchId>')
  .description('Run the validation gate on a candidate patch')
  .requiredOption('--baseline <score>', 'Baseline metric score')
  .requiredOption('--candidate <score>', 'Candidate metric score')
  .option('--evaluator <evaluator>', 'Evaluator: retrieval, project_graph, task_harness', 'retrieval')
  .option('--metric <metric>', 'Metric: f1, mrr, accuracy, soft_score, mixed', 'f1')
  .action(async (patchId: string, options: { baseline: string; candidate: string; evaluator: string; metric: string }) => {
    const memory = createMemory();
    try {
      await memory.init();
      const evaluation = memory.evaluation.evaluateSkillPatchScoreGate({
        patchId,
        evaluator: options.evaluator as SkillEvolutionEvaluator,
        metric: options.metric as SkillEvolutionMetric,
        baselineScore: Number(options.baseline),
        candidateScore: Number(options.candidate),
        details: { source: 'cli' },
      });
      console.log(`Patch ${evaluation.patchId} evaluated.`);
      console.log(`  Accepted: ${evaluation.accepted}`);
      console.log(`  Delta: ${evaluation.delta.toFixed(4)} (baseline ${evaluation.baselineScore} -> candidate ${evaluation.candidateScore})`);
    } catch (error) {
      console.error('Skill patch evaluate failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

skillEvolutionCommand
  .command('reject <patchId>')
  .description('Reject a candidate patch with an audited reason')
  .requiredOption('--reason <text>', 'Rejection reason')
  .action(async (patchId: string, options: { reason: string }) => {
    const memory = createMemory();
    try {
      await memory.init();
      const rejected = memory.metabolism.rejectSkillPatch({ patchId, reason: options.reason });
      if (!rejected) {
        console.error(`Patch not found: ${patchId}`);
        process.exit(1);
        return;
      }
      console.log(`Patch ${rejected.id} rejected: ${options.reason}`);
    } catch (error) {
      console.error('Skill patch reject failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

skillEvolutionCommand
  .command('best-skill')
  .description('Render the deployable best_skill.md artifact from verified skill nodes')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of skills', '20')
  .action(async (options: { project?: string; limit: string }) => {
    const memory = createMemory();
    try {
      await memory.init();
      const artifact = memory.projections.renderBestSkillArtifact({
        project: options.project,
        limit: parseInt(options.limit, 10),
      });
      if (artifact.sourceNodeIds.length === 0) {
        console.log('No verified skill nodes available to render a best-skill artifact.');
        return;
      }
      console.log(artifact.markdown);
    } catch (error) {
      console.error('Best skill render failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });

skillEvolutionCommand
  .command('optimize')
  .description('Run the optimizer over low-adoption / negative-feedback skill nodes (requires an LLM config)')
  .option('-p, --project <project>', 'Project scope')
  .option('-l, --limit <number>', 'Maximum number of targets', '20')
  .action(async (options: { project?: string; limit: string }) => {
    const memory = createMemory();
    try {
      await memory.init();
      const results = await memory.metabolism.optimizeSkillTargets({
        project: options.project,
        limit: parseInt(options.limit, 10),
      });
      if (results.length === 0) {
        console.log('No skill optimization targets found.');
        return;
      }
      console.log(`Skill optimization run over ${results.length} target(s):\n`);
      for (const result of results) {
        console.log(`- ${result.nodeId}: ${result.outcome}${result.patchId ? ` (patch ${result.patchId})` : ''}`);
      }
    } catch (error) {
      console.error('Skill optimization failed:', errorMessage(error));
      process.exit(1);
    } finally {
      memory.close();
    }
  });
