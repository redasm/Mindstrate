import type { ApiKey } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { listWorkspaceProjects } from '@/lib/workspace-projects';
import { UsersClient } from './UsersClient';

export const dynamic = 'force-dynamic';

export default async function SettingsUsersPage() {
  const memory = await getMemoryReady();
  const users: ApiKey[] = memory.apiKeys.listAll();
  const knownProjects = listWorkspaceProjects(memory);

  return <UsersClient initialUsers={users} knownProjects={knownProjects} />;
}
