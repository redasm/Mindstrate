import type { SkillEvolutionPatch } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { SkillEvolutionClient } from './SkillEvolutionClient';

export const dynamic = 'force-dynamic';

export default async function SettingsSkillEvolutionPage() {
  const memory = await getMemoryReady();
  const patches: SkillEvolutionPatch[] = memory.metabolism.listSkillPatches({ limit: 100 });

  return <SkillEvolutionClient initialPatches={patches} />;
}
