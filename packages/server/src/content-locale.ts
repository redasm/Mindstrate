/**
 * Content locale resolution.
 *
 * Mindstrate generates human-facing text in two places — the project-graph
 * book (system pages, reports, enrichment summaries) and LLM knowledge
 * extraction from commits. Both must obey the operator's configured language
 * (`MINDSTRATE_LOCALE`, falling back to the usual POSIX locale env vars) so the
 * whole knowledge base is internally consistent.
 *
 * This module owns the single source of truth for "which language should
 * generated content be in". It is intentionally domain-neutral so both the
 * project-graph and capture pipelines can depend on it without depending on
 * each other.
 */

export type ContentLocale = 'en' | 'zh';

/** Resolve the configured content locale from the environment. */
export const resolveContentLocale = (): ContentLocale => {
  const locale = [
    process.env['MINDSTRATE_LOCALE'],
    process.env['LC_ALL'],
    process.env['LC_MESSAGES'],
    process.env['LANG'],
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

/**
 * A system-prompt sentence instructing an LLM which language to write all
 * human-facing output in. Used by every generator that produces prose for the
 * knowledge base so the locale is honored uniformly.
 */
export const contentLanguageInstruction = (): string =>
  resolveContentLocale() === 'zh'
    ? 'Write ALL human-facing output (titles, descriptions, summaries, key points) in Simplified Chinese, regardless of the language of the source commit message, diff, or code comments.'
    : 'Write ALL human-facing output (titles, descriptions, summaries, key points) in English, regardless of the language of the source commit message, diff, or code comments.';
