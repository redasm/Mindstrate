'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { SearchModal } from './SearchModal';
import { UserMenu } from './UserMenu';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useTranslations } from '@/lib/i18n/hooks';

export type TopBarTab = { href: string; label: string; icon: string };

type Props = {
  tabs: TopBarTab[];
  activeHref: string;
  user: { name: string; role: 'admin' | 'member' };
};

export function TopBar({ tabs, activeHref, user }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const t = useTranslations();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="h-14 bg-white topbar-shadow flex items-center px-5 relative z-40 flex-shrink-0">
      <Link href="/" className="flex items-center gap-2.5 mr-8 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 6h16M4 12h10M4 18h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="20" cy="12" r="2.5" fill="white" opacity="0.7" />
          </svg>
        </div>
        <span className="text-lg font-bold tracking-tight text-surface-900">
          <span className="text-brand-600">MS</span> Mindstrate
        </span>
      </Link>

      <nav className="flex items-center gap-1 h-full">
        {tabs.map((tab) => {
          const active = tab.href === activeHref || activeHref.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`tab-link h-full flex items-center px-3.5 text-sm font-medium ${
                active ? 'active' : ''
              }`}
            >
              <Icon icon={tab.icon} className="mr-1.5 text-sm" />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-surface-200 bg-surface-50 text-surface-400 text-sm hover:border-surface-300 hover:text-surface-600 transition-all"
        >
          <Icon icon="lucide:search" className="text-sm" />
          <span className="font-medium">{t.nav.search}</span>
          <div className="flex items-center gap-0.5 ml-1">
            <kbd className="px-1 py-0.5 text-[10px] font-mono font-medium text-surface-400 bg-white border border-surface-200 rounded">⌘</kbd>
            <kbd className="px-1 py-0.5 text-[10px] font-mono font-medium text-surface-400 bg-white border border-surface-200 rounded">K</kbd>
          </div>
        </button>
        <LocaleSwitcher />
        {user.role === 'admin' && (
          <Link
            href="/settings"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-all"
            title={t.nav.settingsTitle}
          >
            <Icon icon="lucide:settings" className="text-lg" />
          </Link>
        )}
        <UserMenu name={user.name} role={user.role} />
      </div>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
