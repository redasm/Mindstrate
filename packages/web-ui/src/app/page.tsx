import { redirect } from 'next/navigation';
import { readSession, resolveVisibleProjects } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RootRedirect() {
  const session = await readSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/settings');

  const visible = await resolveVisibleProjects(session);
  if (visible.length === 0) {
    redirect('/login?reason=no-projects');
  }
  redirect(`/p/${encodeURIComponent(visible[0])}/knowledge`);
}
