/**
 * Mindstrate Team Server bootstrap.
 *
 * The HTTP surface now lives in focused route modules; this file is only
 * responsible for process wiring and lifecycle management.
 */

import pino from 'pino';
import { Mindstrate } from '@mindstrate/server';
import { createApp } from './app.js';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
});

const port = parseInt(process.env['TEAM_PORT'] ?? '3388', 10);
const apiKey = process.env['TEAM_API_KEY'] ?? '';
const memory = new Mindstrate();
const app = createApp({ apiKey, memory });

const warnIfAuthDisabled = (): void => {
  if (apiKey) {
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
