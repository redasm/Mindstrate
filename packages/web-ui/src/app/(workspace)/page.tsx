import { redirect } from 'next/navigation';
import { readSession, resolveVisibleProjects } from '@/lib/session';
import { EmptyState } from '@/components/ui/EmptyState';
import { detectLocale } from '@/lib/i18n';
import { getTranslations } from '@/lib/i18n/translations';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLanding() {
  const session = await readSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/settings');

  const projects = await resolveVisibleProjects(session);
  const first = projects[0];
  if (first) {
    redirect(`/p/${encodeURIComponent(first)}/knowledge`);
  }

  const t = getTranslations(await detectLocale());

  return (
    <div className="p-12">
      <EmptyState
        icon="lucide:folder-open"
        title={t.sidebar.emptyAdmin === 'No projects yet.' || t.sidebar.emptyAdmin === '还没有项目。'
          ? t.sidebar.emptyAdmin.replace(/[.。]$/, '')
          : t.sidebar.emptyAdmin}
        description={t.empty.noProjectsMember}
      />
    </div>
  );
}
