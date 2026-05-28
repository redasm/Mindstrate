'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../ui/Icon';
import { useLocale, useTranslations } from '@/lib/i18n/hooks';
import type { Locale } from '@/lib/i18n/index';

export function LocaleSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations();
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const choose = async (next: Locale) => {
    setOpen(false);
    if (next === locale) return;
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    });
    startTransition(() => router.refresh());
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-all"
        title={t.localeSwitcher.label}
      >
        <Icon icon="lucide:globe" className="text-lg" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 bg-white border border-surface-200 rounded-xl shadow-large py-1 z-50">
          <button
            type="button"
            onClick={() => choose('en')}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-50 ${
              locale === 'en' ? 'text-brand-600 font-semibold' : 'text-surface-700'
            }`}
          >
            <span>{t.localeSwitcher.english}</span>
            {locale === 'en' && <Icon icon="lucide:check" className="text-sm" />}
          </button>
          <button
            type="button"
            onClick={() => choose('zh')}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-50 ${
              locale === 'zh' ? 'text-brand-600 font-semibold' : 'text-surface-700'
            }`}
          >
            <span>{t.localeSwitcher.chinese}</span>
            {locale === 'zh' && <Icon icon="lucide:check" className="text-sm" />}
          </button>
        </div>
      )}
    </div>
  );
}
