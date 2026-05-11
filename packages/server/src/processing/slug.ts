/**
 * Slug primitives for filesystem-safe identifiers.
 *
 * Used wherever Mindstrate must derive a stable, ASCII-only filename or id
 * from a free-form title (Obsidian projections, portable bundle ids, etc.).
 */

/**
 * Lowercase the input, collapse non-ASCII-alphanumerics into hyphens, and
 * trim leading/trailing hyphens. Returns `fallback` (default `'untitled'`)
 * when the result would be empty so callers always get a non-empty slug.
 */
export const slugifyAscii = (value: string, fallback = 'untitled'): string => (
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback
);
