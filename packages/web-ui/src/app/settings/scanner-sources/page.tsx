import type { ScanSource } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { ScannerSourcesClient } from './ScannerSourcesClient';

export const dynamic = 'force-dynamic';

export default async function SettingsScannerSourcesPage() {
  const memory = await getMemoryReady();
  const sources: ScanSource[] = memory.scanner.listSources();
  const knownProjects = memory.context.listKnownProjects();

  return <ScannerSourcesClient initialSources={sources} knownProjects={knownProjects} />;
}
