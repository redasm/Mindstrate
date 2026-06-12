import { getMemoryReady } from '@/lib/memory';
import { listScannerSourceViews } from '@/lib/scanner-source-view';
import { listWorkspaceProjects } from '@/lib/workspace-projects';
import { ScannerSourcesClient } from './ScannerSourcesClient';

export const dynamic = 'force-dynamic';

export default async function SettingsScannerSourcesPage() {
  const memory = await getMemoryReady();
  const sources = listScannerSourceViews(memory);
  const knownProjects = listWorkspaceProjects(memory);

  return <ScannerSourcesClient initialSources={sources} knownProjects={knownProjects} />;
}
