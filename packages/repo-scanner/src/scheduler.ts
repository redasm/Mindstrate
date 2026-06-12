import { errorMessage } from '@mindstrate/server';
import type { ScanExecutionResult } from './types.js';
import { RepoScannerService } from './scanner-service.js';

export class RepoScannerDaemon {
  private service: RepoScannerService;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<ScanExecutionResult[]> | null = null;
  private readonly onSourceError: (sourceId: string, message: string) => void;

  constructor(
    service: RepoScannerService,
    options: { tickMs?: number; onSourceError?: (sourceId: string, message: string) => void } = {},
  ) {
    this.service = service;
    this.intervalMs = options.tickMs ?? 30_000;
    this.onSourceError = options.onSourceError
      ?? ((sourceId, message) => console.error(`[repo-scanner] source ${sourceId} failed: ${message}`));
  }

  start(): void {
    if (this.timer) return;
    // A previous process that died mid-scan leaves runs stuck in
    // `running`, which blocks the source forever via hasRunningRun.
    // Daemon startup is the one moment no scan can be in flight.
    const recovered = this.service.scanner.recoverOrphanedRuns();
    if (recovered > 0) {
      console.log(`[repo-scanner] recovered ${recovered} orphaned running run(s) from a previous process`);
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /** Stops the schedule and waits for any in-flight tick so callers can safely close the store. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight;
    }
  }

  /**
   * One failing source must not abort the rest of the due sources or escape
   * as an unhandled rejection (which would kill the daemon process) — the
   * failure is already recorded on the scan run by `runSource`; here it is
   * only reported and skipped.
   */
  async tick(): Promise<ScanExecutionResult[]> {
    if (this.inFlight) return [];
    const run = this.runDueSources();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  private async runDueSources(): Promise<ScanExecutionResult[]> {
    const due = this.service.scanner.listDueSources();
    const results: ScanExecutionResult[] = [];
    for (const source of due) {
      try {
        const result = await this.service.runSource(source.id);
        results.push(result);
        console.log(
          `[repo-scanner] source ${source.id}: ${result.mode} `
          + `seen=${result.itemsSeen} imported=${result.itemsImported} skipped=${result.itemsSkipped} failed=${result.itemsFailed}`,
        );
      } catch (error) {
        this.onSourceError(source.id, errorMessage(error));
      }
    }
    return results;
  }
}
