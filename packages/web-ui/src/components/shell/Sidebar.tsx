'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '../ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

export type SidebarProject = { name: string; hasAlert?: boolean };

type Props = {
  projects: SidebarProject[];
  currentProject?: string;
  isAdmin: boolean;
};

const STORAGE_KEY = 'ms.sidebar.collapsed';

export function Sidebar({ projects, currentProject, isAdmin }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const handleDelete = async (name: string) => {
    if (deleting) return;
    if (!window.confirm(t.sidebar.deleteProjectConfirm.replace('{PROJECT}', name))) return;
    setDeleting(name);
    try {
      const res = await fetch(`/api/admin/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error ?? t.sidebar.deleteProjectFailed);
        return;
      }
      if (name === currentProject) {
        router.push('/');
      } else {
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  };

  const visible = useMemo(() => {
    if (!filter) return projects;
    const q = filter.toLowerCase();
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, filter]);

  // Compute target href for an entry — try to preserve the current sub-tab.
  const subTab = useMemo(() => {
    const match = pathname.match(/^\/p\/[^/]+\/(.+)$/);
    return match ? match[1] : 'knowledge';
  }, [pathname]);

  if (collapsed) {
    return (
      <aside className="w-12 bg-white border-r border-surface-200 flex flex-col items-center py-2 flex-shrink-0">
        <button
          type="button"
          onClick={toggle}
          className="w-8 h-8 flex items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-all"
          title={t.sidebar.expand}
        >
          <Icon icon="lucide:panel-left-open" className="text-sm" />
        </button>
        <div className="mt-2 space-y-1 px-1.5 w-full">
          {visible.map((p) => {
            const isActive = p.name === currentProject;
            return (
              <Link
                key={p.name}
                href={`/p/${encodeURIComponent(p.name)}/${subTab}`}
                title={p.name}
                className={`flex items-center justify-center h-8 rounded-md text-xs font-bold ${
                  isActive ? 'bg-brand-100 text-brand-700' : 'bg-surface-50 text-surface-500 hover:bg-surface-100'
                }`}
              >
                {p.name.charAt(0).toUpperCase()}
              </Link>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-60 bg-white border-r border-surface-200 flex flex-col flex-shrink-0 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-surface-100">
        <span className="text-xs font-bold text-surface-400 uppercase tracking-wider">{t.sidebar.projects}</span>
        <button
          type="button"
          onClick={toggle}
          className="w-6 h-6 flex items-center justify-center rounded text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-all"
          title={t.sidebar.collapse}
        >
          <Icon icon="lucide:panel-left-close" className="text-sm" />
        </button>
      </div>

      {projects.length > 20 && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-50 border border-surface-100">
            <Icon icon="lucide:search" className="text-xs text-surface-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t.sidebar.filterPlaceholder}
              className="bg-transparent text-xs text-surface-700 placeholder-surface-400 outline-none w-full font-medium"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {visible.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-surface-400">
            {isAdmin ? t.sidebar.emptyAdmin : t.sidebar.emptyMember}
          </div>
        )}
        {visible.map((p) => {
          const isActive = p.name === currentProject;
          return (
            <div
              key={p.name}
              className={`sidebar-item group flex items-center gap-2.5 px-3 py-2 rounded-lg relative ${isActive ? 'active' : ''}`}
            >
              <Link
                href={`/p/${encodeURIComponent(p.name)}/${subTab}`}
                className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
              >
                <div
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isActive ? 'bg-brand-100 text-brand-600' : 'bg-surface-100 text-surface-500'
                  }`}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <span
                  className={`text-sm truncate ${
                    isActive ? 'font-semibold text-brand-700' : 'font-medium text-surface-600'
                  }`}
                >
                  {p.name}
                </span>
                {p.hasAlert && <div className="notification-dot" />}
              </Link>
              {isAdmin && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <Link
                    href={`/settings/scanner-sources?project=${encodeURIComponent(p.name)}`}
                    title={t.sidebar.manageProject}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:bg-surface-100 hover:text-brand-600 transition-all"
                  >
                    <Icon icon="lucide:settings-2" className="text-sm" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(p.name)}
                    disabled={deleting === p.name}
                    title={t.sidebar.deleteProject}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-surface-400 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
                  >
                    <Icon
                      icon={deleting === p.name ? 'lucide:loader-2' : 'lucide:trash-2'}
                      className={`text-sm ${deleting === p.name ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <div className="px-3 py-3 border-t border-surface-100">
          <Link
            href="/settings/scanner-sources?new=git"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-brand-600 hover:bg-brand-50 transition-all"
          >
            <Icon icon="lucide:plus-circle" className="text-base" />
            {t.sidebar.addProject}
          </Link>
        </div>
      )}
    </aside>
  );
}
