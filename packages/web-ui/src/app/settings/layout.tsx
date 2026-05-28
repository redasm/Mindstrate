import { redirect } from 'next/navigation';
import { readSession } from '@/lib/session';
import { SettingsShell } from '@/components/shell/SettingsShell';

export const dynamic = 'force-dynamic';

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/');

  return (
    <SettingsShell user={{ name: session.name, role: session.role }}>{children}</SettingsShell>
  );
}
