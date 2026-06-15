import type { EvalCase } from '@mindstrate/protocol';
import { getMemoryReady } from '@/lib/memory';
import { EvalDatasetClient } from './EvalDatasetClient';

export const dynamic = 'force-dynamic';

export default async function SettingsEvalDatasetPage() {
  const memory = await getMemoryReady();
  const cases: EvalCase[] = memory.evaluation.listEvalCases();

  return <EvalDatasetClient initialCases={cases} />;
}
