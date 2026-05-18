/**
 * MCP server data directory resolution.
 *
 * Local-mode MCP servers used to default to `~/.mindstrate` whenever the
 * caller did not pass `MINDSTRATE_DATA_DIR` explicitly. That worked when
 * a user had one project, but as soon as a project ran `mindstrate setup
 * --data-dir <project>/.mindstrate` (the default for `mindstrate init` /
 * `mindstrate setup`) the project's data lived in `<project>/.mindstrate`
 * while the IDE-launched MCP server still wrote to `~/.mindstrate`. The
 * two databases drifted silently and every "why does context_assemble
 * see different nodes than my Node script?" bug had this split at its
 * root.
 *
 * `resolveLocalDataDir` walks the same priority chain a developer
 * would expect:
 *
 *   1. `MINDSTRATE_DATA_DIR` env var (explicit override, used by
 *      `mindstrate setup-mcp` when it writes IDE client configs).
 *   2. `<cwd>/.mindstrate` if it exists (the project was set up in this
 *      directory).
 *   3. Walk up from `cwd` to the first ancestor that contains
 *      `.mindstrate` — this catches the case where the IDE launches
 *      MCP from a subdirectory of the project.
 *   4. Fall back to `~/.mindstrate` and log a warning so the developer
 *      can see why their project knowledge is missing.
 *
 * The function only inspects existence, never creates anything. Mindstrate
 * itself will materialize the directory on first write.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type pino from 'pino';

export interface ResolveLocalDataDirOptions {
  /** Working directory the MCP process was launched in. */
  cwd?: string;
  /** Optional logger used to surface the choice to the user. */
  logger?: pino.Logger;
}

export const PROJECT_DATA_DIR_NAME = '.mindstrate';

export const resolveLocalDataDir = (options: ResolveLocalDataDirOptions = {}): string | undefined => {
  const cwd = options.cwd ?? process.cwd();
  const logger = options.logger;

  const explicit = process.env['MINDSTRATE_DATA_DIR']?.trim();
  if (explicit && explicit.length > 0) {
    logger?.info({ dataDir: explicit, source: 'env' }, 'MCP local mode using explicit MINDSTRATE_DATA_DIR');
    return explicit;
  }

  const ancestor = findProjectDataDir(cwd);
  if (ancestor) {
    logger?.info(
      { dataDir: ancestor, source: 'project' },
      'MCP local mode resolved data dir to project-local .mindstrate',
    );
    return ancestor;
  }

  const home = path.join(os.homedir(), PROJECT_DATA_DIR_NAME);
  logger?.warn(
    { dataDir: home, source: 'home-fallback', cwd },
    'No project-local .mindstrate found near cwd; falling back to home directory. '
      + 'Run `mindstrate setup` in your project root if you expected project-scoped data.',
  );
  // Returning `undefined` lets Mindstrate config still apply its
  // built-in default (~/.mindstrate) without us having to compute it
  // — but logging the resolved path keeps the diagnostic accurate.
  return undefined;
};

/**
 * Walk up from `start` looking for the first ancestor that contains a
 * `.mindstrate` directory. Returns the absolute path to that directory
 * (not the project root) so the caller can pass it straight to
 * `new Mindstrate({ dataDir })`.
 *
 * Stops at the filesystem root or the user's home directory, whichever
 * comes first — we never want to claim the home `.mindstrate` as a
 * project-local match (that is the fallback case, handled separately).
 */
const findProjectDataDir = (start: string): string | undefined => {
  const home = os.homedir();
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, PROJECT_DATA_DIR_NAME);
    // Skip the home directory match — `~/.mindstrate` is the global
    // fallback, not a project-local store.
    if (current !== home && existsAsDir(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

const existsAsDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
