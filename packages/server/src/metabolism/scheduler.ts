import type { RunMetabolismOptions } from './metabolism-engine.js';

export interface MetabolismSchedulerOptions {
  project?: string;
  intervalMs: number;
  runMetabolism: (options: RunMetabolismOptions) => Promise<unknown> | unknown;
}

export class MetabolismScheduler {
  private readonly options: MetabolismSchedulerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: MetabolismSchedulerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;

    clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;

    this.running = true;
    try {
      await this.options.runMetabolism({
        project: this.options.project,
        trigger: 'scheduled',
      });
    } finally {
      this.running = false;
    }
  }
}
