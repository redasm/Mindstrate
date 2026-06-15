import type { ProjectLlmConfig } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { listWorkspaceProjects } from '@/lib/workspace-projects';
import { LlmConfigsClient } from './LlmConfigsClient';

export const dynamic = 'force-dynamic';

const maskKey = (key: string): string => {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return `••••${key.slice(-4)}`;
};

export default async function SettingsLlmConfigsPage() {
  const memory = await getMemoryReady();
  const configs: ProjectLlmConfig[] = memory.llmConfigs.list().map((c) => ({
    ...c,
    openaiApiKey: maskKey(c.openaiApiKey),
  }));
  const knownProjects = listWorkspaceProjects(memory);

  return <LlmConfigsClient initialConfigs={configs} knownProjects={knownProjects} />;
}
