/**
 * Tiny progress printers shared between local-setup steps.
 *
 * Pulled out of `setup.ts` because they are the only stateful helpers in
 * the original file: each printer captures throttling state across calls,
 * which makes them a natural standalone module.
 */

import type {
  ProjectGraphIndexProgress,
  ProjectGraphScanProgress,
} from '@mindstrate/server';

export type SetupProgress = (message: string) => void;
export type ScanProgress = (event: ProjectGraphScanProgress) => void;
export type IndexProgress = (event: ProjectGraphIndexProgress) => void;

export const printStepProgress = (total: number, prefix = 'Setup'): SetupProgress => {
  let current = 0;
  return (message) => {
    current += 1;
    console.log(`  [${current}/${total}] ${prefix}: ${message}...`);
  };
};

export const printScanProgress = (prefix: string): ScanProgress & { flush: () => void } => {
  let lastOutputAt = 0;
  let lastEvent: ProjectGraphScanProgress | undefined;
  const print = (event: ProjectGraphScanProgress, force = false): void => {
    lastEvent = event;
    const now = Date.now();
    if (!force && now - lastOutputAt < 1000 && event.files % 200 !== 0) return;
    lastOutputAt = now;
    const pathLabel = event.path.length > 90 ? `...${event.path.slice(-87)}` : event.path;
    console.log(
      `      ${prefix}: ${event.files} files, ${event.directories} dirs, `
      + `${event.generatedFiles} generated, ${event.metadataOnlyFiles} metadata-only, `
      + `${event.skippedFiles} skipped, ${event.phase} ${pathLabel}`,
    );
  };
  const progress = ((event: ProjectGraphScanProgress) => print(event)) as ScanProgress & { flush: () => void };
  progress.flush = () => {
    if (lastEvent) print(lastEvent, true);
  };
  return progress;
};

export const printIndexProgress = (prefix: string): IndexProgress & { flush: () => void } => {
  let lastOutputAt = 0;
  let lastEvent: ProjectGraphIndexProgress | undefined;
  const print = (event: ProjectGraphIndexProgress, force = false): void => {
    lastEvent = event;
    const now = Date.now();
    if (!force && now - lastOutputAt < 1000 && event.filesProcessed % 200 !== 0) return;
    lastOutputAt = now;
    const pathLabel = event.path ? ` ${event.path.length > 80 ? `...${event.path.slice(-77)}` : event.path}` : '';
    console.log(
      `      ${prefix}: ${event.phase} ${event.filesProcessed}/${event.filesTotal} files, `
      + `${event.nodes} nodes, ${event.edges} edges, ${event.generatedFiles} generated, `
      + `${event.metadataOnlyRoots} metadata-only roots, ${event.skippedFiles} skipped${pathLabel}`,
    );
  };
  const progress = ((event: ProjectGraphIndexProgress) => print(event)) as IndexProgress & { flush: () => void };
  progress.flush = () => {
    if (lastEvent) print(lastEvent, true);
  };
  return progress;
};
