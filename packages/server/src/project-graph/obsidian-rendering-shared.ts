/**
 * Shared formatting helpers for the Obsidian projection writers.
 *
 * Kept in a dedicated module to avoid two-way imports between the per-page
 * writers (system pages, node pages, flow/binding pages).
 */

export const formatEvidenceLocation = (filePath: string, startLine?: number, endLine?: number): string => {
  if (typeof startLine !== 'number') return filePath;
  if (typeof endLine === 'number' && endLine !== startLine) return `${filePath}:${startLine}-${endLine}`;
  return `${filePath}:${startLine}`;
};

export const nodeWikiLink = (
  label: string,
  slug: string,
): string => `[[nodes/${slug}|${escapeWikiLabel(label)}]]`;

export const escapeWikiLabel = (value: string): string =>
  value.replace(/[\[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
