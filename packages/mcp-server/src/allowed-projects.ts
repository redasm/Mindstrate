/**
 * Client-side project allow-list guard.
 *
 * The Team Server is the authoritative ACL. This module is a UX guard
 * rail: it stops the AI tool from sending a write that the server would
 * reject anyway, with a clearer error than HTTP 403.
 *
 * Reads MINDSTRATE_PROJECTS once at module load. Format: comma-separated
 * project names. `*` (or empty / unset) means wildcard.
 *
 * Usage at the top of any write handler that accepts a `project` arg:
 *
 *   assertProjectAllowed(input.project);
 */

const RAW = (typeof process !== 'undefined' && process.env?.MINDSTRATE_PROJECTS) || '';

const ALLOWED: Set<string> | null = (() => {
  const trimmed = RAW.trim();
  if (trimmed === '' || trimmed === '*') return null;
  const entries = trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0 || entries.includes('*')) return null;
  return new Set(entries);
})();

export const isWildcard = (): boolean => ALLOWED === null;

export const listAllowedProjects = (): string[] | null =>
  ALLOWED === null ? null : [...ALLOWED];

export class ProjectNotAllowedError extends Error {
  constructor(project: string, allowed: string[]) {
    super(
      `Project "${project}" is not in your MINDSTRATE_PROJECTS allow-list ` +
      `(${allowed.join(', ')}). Re-run the installer to update, or ask your ` +
      `admin to attach this project to your API key.`,
    );
    this.name = 'ProjectNotAllowedError';
  }
}

/**
 * Throws if `project` is set and not allowed. Wildcard or undefined
 * project pass through unchanged — server-side ACL handles those.
 */
export const assertProjectAllowed = (project: string | undefined): void => {
  if (project === undefined || project === null || project === '') return;
  if (ALLOWED === null) return;
  if (!ALLOWED.has(project)) {
    throw new ProjectNotAllowedError(project, [...ALLOWED]);
  }
};
