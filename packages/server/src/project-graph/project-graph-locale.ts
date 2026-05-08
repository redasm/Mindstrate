export type ProjectGraphLocale = 'en' | 'zh';

export const resolveProjectGraphLocale = (): ProjectGraphLocale => {
  const locale = [
    process.env['MINDSTRATE_LOCALE'],
    process.env['LC_ALL'],
    process.env['LC_MESSAGES'],
    process.env['LANG'],
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].find((value) => typeof value === 'string' && value.trim().length > 0);

  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

export const projectGraphLanguageInstruction = (): string =>
  resolveProjectGraphLocale() === 'zh'
    ? 'Write all human-facing labels, summaries, risks, and questions in Simplified Chinese.'
    : 'Write all human-facing labels, summaries, risks, and questions in English.';
