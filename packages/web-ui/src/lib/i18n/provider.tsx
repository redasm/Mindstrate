'use client';

import { type ReactNode } from 'react';
import { LocaleContext } from './hooks';
import type { Locale } from './index';

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>
      {children}
    </LocaleContext.Provider>
  );
}
