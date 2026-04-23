/**
 * Mindstrate Web UI - i18n Infrastructure
 *
 * Lightweight internationalization without external dependencies.
 * Supports zh (Chinese) and en (English).
 * Default locale is detected from the system/browser environment.
 */

export type Locale = 'zh' | 'en';

export const SUPPORTED_LOCALES: Locale[] = ['zh', 'en'];

/**
 * Detect the user's preferred locale.
 *
 * Priority:
 * 1. MINDSTRATE_LOCALE environment variable (server-side)
 * 2. Accept-Language header (server-side, via headers())
 * 3. navigator.language (client-side)
 * 4. Default: 'en'
 */
export function detectLocale(): Locale {
  // Server-side: env variable
  const envLocale = typeof process !== 'undefined'
    ? process.env['MINDSTRATE_LOCALE']
    : undefined;
  if (envLocale) {
    const env = envLocale.toLowerCase();
    if (env.startsWith('zh')) return 'zh';
    return 'en';
  }

  // Client-side: navigator
  if (typeof navigator !== 'undefined' && navigator.language) {
    if (navigator.language.startsWith('zh')) return 'zh';
    return 'en';
  }

  return 'en';
}

/** Get the HTML lang attribute value for a locale */
export function getHtmlLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

/** Get the date formatting locale string */
export function getDateLocale(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}
