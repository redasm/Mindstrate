'use client';

import { usePathname } from 'next/navigation';
import { TopBar, type TopBarTab } from './TopBar';
import { Sidebar, type SidebarProject } from './Sidebar';
import { useTranslations } from '@/lib/i18n/hooks';

type Props = {
  user: { name: string; role: 'admin' | 'member' };
  projects: SidebarProject[];
  children: React.ReactNode;
};

export function WorkspaceShell({ user, projects, children }: Props) {
  const pathname = usePathname();
  const t = useTranslations();
  const match = pathname.match(/^\/p\/([^/]+)/);
  const currentProject = match ? decodeURIComponent(match[1]) : projects[0]?.name ?? '';
  const tabs: TopBarTab[] = currentProject
    ? [
        { href: `/p/${encodeURIComponent(currentProject)}/knowledge`,     label: t.nav.workspace.knowledge,    icon: 'lucide:book-open' },
        { href: `/p/${encodeURIComponent(currentProject)}/project-graph`, label: t.nav.workspace.projectGraph, icon: 'lucide:network' },
        { href: `/p/${encodeURIComponent(currentProject)}/bundles`,       label: t.nav.workspace.bundles,      icon: 'lucide:package' },
        { href: `/p/${encodeURIComponent(currentProject)}/knowledge/new`, label: t.nav.workspace.add,          icon: 'lucide:plus' },
      ]
    : [];

  return (
    <div className="flex flex-col h-screen">
      <TopBar tabs={tabs} activeHref={pathname} user={user} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar projects={projects} currentProject={currentProject} isAdmin={user.role === 'admin'} />
        <main className="flex-1 overflow-y-auto bg-surface-50">{children}</main>
      </div>
    </div>
  );
}
