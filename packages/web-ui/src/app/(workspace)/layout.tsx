import { redirect } from 'next/navigation';
import { readSession, resolveVisibleProjects } from '@/lib/session';
import { WorkspaceShell } from '@/components/shell/WorkspaceShell';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login');

  const projects = await resolveVisibleProjects(session);

  return (
    <WorkspaceShell
      user={{ name: session.name, role: session.role }}
      projects={projects.map((name) => ({ name }))}
    >
      {children}
    </WorkspaceShell>
  );
}
