import type { ApiKey } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { ApiKeysClient } from './ApiKeysClient';

export const dynamic = 'force-dynamic';

export default async function AdminApiKeysPage() {
  const memory = await getMemoryReady();
  const keys: ApiKey[] = memory.apiKeys.listActive();
  const projects = memory.context.listKnownProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Member API keys</h1>
        <form action="/api/admin/logout" method="post">
          <button
            type="submit"
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
            formMethod="post"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-600">
        Keys created here let members call the team server scoped to specific projects and scopes.
        The plaintext value is shown once on creation and remains visible to the admin so it can be
        re-sent if a member loses it. Use revoke to invalidate a key.
      </p>
      <ApiKeysClient initialKeys={keys} knownProjects={projects} />
    </div>
  );
}
