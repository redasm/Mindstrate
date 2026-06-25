/**
 * Human-readable scan-coverage diagnostics for the local CLI.
 *
 * The project graph index can silently cover only part of a repo (restricted
 * sourceRoots, dropped non-existent roots, skipped oversized/unreadable
 * files). These formatters turn the structured `diagnostics` on the index
 * result into actionable console lines so a partial first index is visible
 * instead of a black box — the CLI mirror of the repo-scanner's scan-log
 * warnings.
 */

import type { ProjectGraphScanDiagnostics } from '@mindstrate/server';

/** Build coverage warning/info lines from index diagnostics (empty if all clear). */
export const formatScanCoverageLines = (diagnostics: ProjectGraphScanDiagnostics): string[] => {
  const lines: string[] = [];

  if (diagnostics.missingSourceRoots.length > 0) {
    lines.push(
      `  Warning: configured sourceRoots not found and skipped: ${diagnostics.missingSourceRoots.join(', ')}. `
        + 'Their files are NOT in the graph — fix the detection rule or scan root.',
    );
  }

  if (diagnostics.coverage === 'restricted' && diagnostics.unscannedTopLevelDirectories.length > 0) {
    lines.push(
      `  Warning: restricted scan — only [${diagnostics.requestedSourceRoots.join(', ')}] deep-scanned. `
        + `Not scanned: ${diagnostics.unscannedTopLevelDirectories.join(', ')}. `
        + 'Add them to sourceRoots (.mindstrate/rules/*.json) and re-index if they hold source.',
    );
  }

  const reasons = Object.entries(diagnostics.skippedByReason);
  if (reasons.length > 0) {
    const breakdown = reasons.map(([reason, count]) => `${reason}=${count}`).join(', ');
    let line = `  Skipped files by reason: ${breakdown}.`;
    if (diagnostics.oversizedExamples.length > 0) {
      const examples = diagnostics.oversizedExamples
        .map((file: { path: string; sizeBytes: number }) => `${file.path} (${Math.round(file.sizeBytes / 1024 / 1024)}MB)`)
        .join(', ');
      line += ` Oversized examples: ${examples}. Raise MINDSTRATE_SCAN_MAX_FILE_BYTES to include them.`;
    }
    lines.push(line);
  }

  return lines;
};
