/**
 * JSON file storage primitives.
 *
 * Centralizes the `fs.existsSync + fs.readFileSync + JSON.parse + try/catch`
 * idiom that was duplicated in 12+ places with subtly different fallback
 * behavior. The two variants make the intended failure mode explicit at
 * the call site:
 *
 *   - `readJsonFile<T>(path)`: returns `null` when the file is missing,
 *     unreadable, or not valid JSON. Use for opportunistic reads where the
 *     caller has a sensible default (config files, caches, optional
 *     manifests).
 *
 *   - `readJsonFileOrThrow<T>(path)`: surfaces a descriptive `Error`
 *     carrying the path. Use when the file is required and downstream
 *     code cannot proceed without it.
 *
 * Neither variant validates the JSON shape; callers must narrow the
 * returned `unknown`/`T` themselves (or layer Zod / explicit guards on
 * top).
 */

import * as fs from 'node:fs';

export const readJsonFile = <T>(path: string): T | null => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const readJsonFileOrThrow = <T>(path: string): T => {
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read JSON file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON file ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};
