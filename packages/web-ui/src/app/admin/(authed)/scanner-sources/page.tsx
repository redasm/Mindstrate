import type { ScanSource } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { ScannerSourcesClient } from './ScannerSourcesClient';

export const dynamic = 'force-dynamic';

export default async function AdminScannerSourcesPage() {
  const memory = await getMemoryReady();
  const sources: ScanSource[] = memory.scanner.listSources();
  const knownProjects = memory.context.listKnownProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Scanner sources</h1>
        <form action="/api/admin/logout" method="post">
          <button
            type="submit"
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
          >
            Sign out
          </button>
        </form>
      </div>
      <p className="text-sm text-gray-600">
        Configure Git or Perforce sources for the repo-scanner daemon. Each source carries its own
        connection details (remote URL + token for Git, host/user/password for P4), so a single
        scanner container can serve multiple projects backed by different servers and accounts.
        Credentials are stored as written and remain visible to admins.
      </p>
      <ScannerSourcesClient initialSources={sources} knownProjects={knownProjects} />
    </div>
  );
}
