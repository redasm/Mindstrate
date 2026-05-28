/**
 * Mindstrate Web UI - i18n Infrastructure
 *
 * Lightweight internationalization without external dependencies.
 * Supports zh (Chinese) and en (English).
 */

import { cookies, headers } from 'next/headers';

export type Locale = 'zh' | 'en';

export const SUPPORTED_LOCALES: Locale[] = ['zh', 'en'];

export const LOCALE_COOKIE = 'mindstrate-locale';

/**
 * Server-side locale detection (async — uses next/headers).
 *
 * Priority:
 * 1. `mindstrate-locale` cookie (set by the in-app switcher)
 * 2. `MINDSTRATE_LOCALE` env variable
 * 3. `Accept-Language` request header
 * 4. Default: 'en'
 */
export async function detectLocale(): Promise<Locale> {
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (cookieLocale === 'zh' || cookieLocale === 'en') return cookieLocale;
  } catch {
    // cookies() not available in this rendering context — fall through
  }

  const envLocale = typeof process !== 'undefined' ? process.env['MINDSTRATE_LOCALE'] : undefined;
  if (envLocale) {
    return envLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  try {
    const hdrs = await headers();
    const accept = hdrs.get('accept-language') ?? '';
    if (accept.toLowerCase().includes('zh')) return 'zh';
  } catch {
    // headers() not available — fall through
  }

  return 'en';
}

export function getHtmlLang(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

export function getDateLocale(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}
