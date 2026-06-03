'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TopBar, type TopBarTab } from '@/components/shell/TopBar';
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from '@/lib/i18n/hooks';

export function SettingsShell({
  user,
  children,
}: {
  user: { name: string; role: 'admin' | 'member' };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations();
  const tabs: TopBarTab[] = [
    { href: '/settings',                 label: t.nav.settings.overview,       icon: 'lucide:layout-dashboard' },
    { href: '/settings/users',           label: t.nav.settings.users,          icon: 'lucide:users' },
    { href: '/settings/scanner-sources', label: t.nav.settings.scannerSources, icon: 'lucide:radar' },
    { href: '/settings/llm-configs',     label: t.nav.settings.llmConfigs,     icon: 'lucide:brain-circuit' },
    { href: '/settings/ecs',             label: t.nav.settings.ecs,            icon: 'lucide:cpu' },
    { href: '/settings/skill-evolution', label: t.nav.settings.skillEvolution, icon: 'lucide:sparkles' },
    { href: '/settings/lineage',         label: t.nav.settings.lineage,        icon: 'lucide:git-branch' },
  ];
  return (
    <div className="flex flex-col h-screen">
      <TopBar tabs={tabs} activeHref={pathname} user={user} />
      <div className="px-5 py-2 border-b border-surface-100 bg-white flex-shrink-0">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-surface-500 hover:text-brand-600 transition-colors"
        >
          <Icon icon="lucide:arrow-left" className="text-sm" />
          {t.nav.settings.back}
        </Link>
      </div>
      <main className="flex-1 overflow-y-auto bg-surface-50">{children}</main>
    </div>
  );
}
