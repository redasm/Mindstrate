import type { ScanExecutionResult } from './types.js';
import { RepoScannerService } from './scanner-service.js';

export class RepoScannerDaemon {
  private service: RepoScannerService;
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(service: RepoScannerService, options: { tickMs?: number } = {}) {
    this.service = service;
    this.intervalMs = options.tickMs ?? 30_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<ScanExecutionResult[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const due = this.service.store.listDueSources();
      const results: ScanExecutionResult[] = [];
      for (const source of due) {
        results.push(await this.service.runSource(source.id));
      }
      return results;
    } finally {
      this.running = false;
    }
  }
}
