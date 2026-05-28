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
}

export const readSchedulerEnvConfig = (env: NodeJS.ProcessEnv = process.env): SchedulerEnvConfig => ({
  enabled: env['MINDSTRATE_METABOLISM_SCHEDULER'] === 'true',
  intervalMs: parseInt(env['MINDSTRATE_METABOLISM_INTERVAL_MS'] ?? '300000', 10),
  project: env['MINDSTRATE_METABOLISM_PROJECT'] || undefined,
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
    });
    logger.info({
      intervalMs: scheduler.intervalMs,
      project: scheduler.project ?? 'global',
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
