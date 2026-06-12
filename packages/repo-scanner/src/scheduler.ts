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
        results.push(await this.service.runSource(source.id));
      } catch (error) {
        this.onSourceError(source.id, errorMessage(error));
      }
    }
    return results;
  }
}
