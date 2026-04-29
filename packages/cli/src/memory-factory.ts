/**
 * Mindstrate instance factory for the CLI.
 *
 * Centralizes how the CLI commands obtain a Mindstrate handle so that
 * future configuration (env-driven defaults, alternate vector backends,
 * etc.) lives in one place instead of being duplicated across command
 * files.
 */

import { Mindstrate } from '@mindstrate/server';

export function createMemory(): Mindstrate {
  return new Mindstrate();
}
