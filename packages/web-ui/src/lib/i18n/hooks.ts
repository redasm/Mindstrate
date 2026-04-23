'use client';

import { createContext, useContext } from 'react';
import type { Locale } from './index';
import type { Translations } from './en';
import { getTranslations } from './translations';

/** React context for the current locale */
export const LocaleContext = createContext<Locale>('en');

/** Hook to get current translations in client components */
export function useTranslations(): Translations {
  const locale = useContext(LocaleContext);
  return getTranslations(locale);
}

/** Hook to get current locale */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}
