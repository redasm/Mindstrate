/**
 * Mindstrate Team Server bootstrap.
 *
 * The HTTP surface now lives in focused route modules; this file is only
 * responsible for process wiring and lifecycle management.
 */

import pino from 'pino';
import { Mindstrate } from '@mindstrate/server';
import { createApp } from './app.js';
import type { TeamApiKey } from './http/auth-middleware.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const port = parseInt(process.env['TEAM_PORT'] ?? '3388', 10);
const apiKey = process.env['TEAM_API_KEY'] ?? '';
const memory = new Mindstrate();
const authKeys = readTeamApiKeys();
const app = createApp({ apiKey, authKeys, memory });

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

export function readTeamApiKeys(env: NodeJS.ProcessEnv = process.env): TeamApiKey[] {
  const rawKeys = env['TEAM_API_KEYS'];
  if (rawKeys) {
    const parsed = JSON.parse(rawKeys) as TeamApiKey[];
    if (!Array.isArray(parsed) || parsed.some((entry) => !entry.key)) {
      throw new Error('TEAM_API_KEYS must be a JSON array of objects with a key field.');
    }
    return parsed;
  }

  const singleKey = env['TEAM_API_KEY'];
  if (!singleKey) {
    throw new Error('TEAM_API_KEY or TEAM_API_KEYS is required for Team Server.');
  }

  return [{
    key: singleKey,
    scopes: ['read', 'write', 'admin'],
    projects: ['*'],
  }];
}

const warnIfAuthDisabled = (): void => {
  if (authKeys.length > 0) {
    logger.info('Authentication: API Key required');
    return;
  }

  logger.warn(
    'SECURITY WARNING: No TEAM_API_KEY configured. Server is running WITHOUT authentication. ' +
    'Anyone with network access can read/write/delete knowledge. ' +
    'Set TEAM_API_KEY environment variable to enable API key authentication. ' +
    'This is acceptable only for local development or trusted private networks.'
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
