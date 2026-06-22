/**
 * Mindstrate Team Server bootstrap.
 *
 * The HTTP surface now lives in focused route modules; this file is only
 * responsible for process wiring and lifecycle management.
 */

import pino from 'pino';
import { Mindstrate, consoleLogger } from '@mindstrate/server';
import { createApp } from './app.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const port = parseInt(process.env['TEAM_PORT'] ?? '3388', 10);
const adminKey = process.env['TEAM_API_KEY'] ?? '';
const memory = new Mindstrate({ logger: consoleLogger });
const app = createApp({ adminKey, memory });

export interface SchedulerEnvConfig {
  enabled: boolean;
  intervalMs: number;
  project?: string;
  optimizeSkills: boolean;
  skillOptimizationEveryTicks: number;
  generateEvalCases: boolean;
  evalCaseGenerationEveryTicks: number;
}

export const readSchedulerEnvConfig = (env: NodeJS.ProcessEnv = process.env): SchedulerEnvConfig => ({
  enabled: env['MINDSTRATE_METABOLISM_SCHEDULER'] === 'true',
  intervalMs: parseInt(env['MINDSTRATE_METABOLISM_INTERVAL_MS'] ?? '300000', 10),
  project: env['MINDSTRATE_METABOLISM_PROJECT'] || undefined,
  optimizeSkills: env['MINDSTRATE_SKILL_EVOLUTION_SCHEDULER'] === 'true',
  skillOptimizationEveryTicks: Math.max(
    1,
    parseInt(env['MINDSTRATE_SKILL_EVOLUTION_EVERY_TICKS'] ?? '12', 10) || 1,
  ),
  generateEvalCases: env['MINDSTRATE_EVAL_DATASET_SCHEDULER'] === 'true',
  evalCaseGenerationEveryTicks: Math.max(
    1,
    parseInt(env['MINDSTRATE_EVAL_DATASET_EVERY_TICKS'] ?? '12', 10) || 1,
  ),
});

const warnIfAuthDisabled = (): void => {
  if (adminKey) {
    logger.info('Authentication: TEAM_API_KEY admin bootstrap configured; member keys resolved from DB.');
    return;
  }

  logger.warn(
    'SECURITY WARNING: No TEAM_API_KEY configured. Server will reject every request. ' +
    'Set TEAM_API_KEY in the environment to enable admin login + member key management via the Web UI.'
  );
};

const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
  logger.info(`Shutting down (${signal})`);
  memory.close();
  process.exit(0);
};

const main = async (): Promise<void> => {
  await memory.init();
  const scheduler = readSchedulerEnvConfig();
  if (scheduler.enabled) {
    memory.metabolism.startMetabolismScheduler({
      project: scheduler.project,
      intervalMs: scheduler.intervalMs,
      optimizeSkills: scheduler.optimizeSkills,
      skillOptimizationEveryTicks: scheduler.skillOptimizationEveryTicks,
      generateEvalCases: scheduler.generateEvalCases,
      evalCaseGenerationEveryTicks: scheduler.evalCaseGenerationEveryTicks,
    });
    logger.info({
      intervalMs: scheduler.intervalMs,
      project: scheduler.project ?? 'global',
      skillOptimization: scheduler.optimizeSkills
        ? `every ${scheduler.skillOptimizationEveryTicks} ticks`
        : 'disabled',
      evalDatasetGeneration: scheduler.generateEvalCases
        ? `every ${scheduler.evalCaseGenerationEveryTicks} ticks`
        : 'disabled',
    }, 'ECS metabolism scheduler started');
  }

  app.listen(port, () => {
    logger.info({ port, dataDir: memory.getConfig().dataDir }, 'Mindstrate Team Server started');
    warnIfAuthDisabled();
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start team server');
  process.exit(1);
});
