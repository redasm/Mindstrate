'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '../ui/Icon';
import { RolePill } from '../ui/Pill';
import { useTranslations } from '@/lib/i18n/hooks';

type Props = {
  name: string;
  role: 'admin' | 'member';
};

export function UserMenu({ name, role }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useTranslations();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  const initial = name.charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-100 transition-all"
      >
        <div className="w-7 h-7 rounded-full user-avatar flex items-center justify-center">{initial}</div>
        <span className="text-sm font-medium text-surface-700">{name}</span>
        <Icon icon="lucide:chevron-down" className="text-xs text-surface-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white border border-surface-200 rounded-xl shadow-large py-1.5 z-50">
          <div className="px-3 py-2 border-b border-surface-100">
            <div className="text-xs text-surface-400 mb-0.5">{t.auth.signedInAs}</div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-surface-900 truncate">{name}</span>
              <RolePill role={role} label={t.auth.role[role]} />
            </div>
          </div>
          {role === 'admin' && (
            <Link
              href="/settings/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-surface-700 hover:bg-surface-50"
            >
              <Icon icon="lucide:users" className="text-sm text-surface-400" />
              {t.auth.manageUsers}
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-surface-700 hover:bg-surface-50"
          >
            <Icon icon="lucide:log-out" className="text-sm text-surface-400" />
            {t.auth.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
