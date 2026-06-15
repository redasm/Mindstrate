import type { Mindstrate, ScanRun, ScanSource } from '@mindstrate/server';

export type ScannerSourceView = ScanSource & {
  latestRun?: ScanRun;
  failedCount: number;
};

export function buildScannerSourceView(memory: Mindstrate, source: ScanSource): ScannerSourceView {
  return {
    ...source,
    latestRun: memory.scanner.listRuns(source.id)[0],
    failedCount: memory.scanner.listFailedItems(source.id).length,
  };
}

export function listScannerSourceViews(memory: Mindstrate): ScannerSourceView[] {
  return memory.scanner.listSources().map((source) => buildScannerSourceView(memory, source));
}
