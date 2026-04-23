/**
 * Translation utilities - works on both server and client.
 * No 'use client' directive so it can be imported anywhere.
 */

import type { Locale } from './index';
import type { Translations } from './en';
import en from './en';
import zh from './zh';

const translations: Record<Locale, Translations> = { en, zh };

/** Get translations for a locale (works on both server and client) */
export function getTranslations(locale: Locale): Translations {
  return translations[locale] ?? translations.en;
}
