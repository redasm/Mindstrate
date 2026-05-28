import { notFound } from 'next/navigation';
import { readSession, canAccessProject } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ProjectScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ project: string }>;
}) {
  const session = await readSession();
  if (!session) notFound();

  const { project } = await params;
  const decoded = decodeURIComponent(project);
  if (!canAccessProject(session, decoded)) notFound();

  return <>{children}</>;
}
