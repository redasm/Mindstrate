import type { RunMetabolismOptions } from './metabolism-engine.js';

export interface MetabolismSchedulerOptions {
  project?: string;
  intervalMs: number;
  runMetabolism: (options: RunMetabolismOptions) => Promise<unknown> | unknown;
  /**
   * Optional skill-evolution optimizer, invoked after metabolism on a tick
   * cadence. When omitted, the scheduler only runs metabolism. Errors are
   * swallowed (logged by the optimizer) so a skill-opt failure never stops the
   * metabolism timer.
   */
  optimizeSkills?: (options: { project?: string }) => Promise<unknown> | unknown;
  /**
   * Run skill optimization once every N metabolism ticks (default 1). Skill
   * optimization is heavier (LLM proposer per target), so a team may want it to
   * run less often than the digest/assimilate pass.
   */
  skillOptimizationEveryTicks?: number;
  /**
   * Optional eval-case generator, invoked after metabolism on a tick cadence.
   * Bootstraps the retrieval evaluation dataset from accumulated knowledge so a
   * team never has to hand-author it. Idempotent; errors are swallowed.
   */
  generateEvalCases?: (options: { project?: string }) => Promise<unknown> | unknown;
  /** Run eval-case generation once every N metabolism ticks (default 1). */
  evalCaseGenerationEveryTicks?: number;
}

export class MetabolismScheduler {
  private readonly options: MetabolismSchedulerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickCount = 0;

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
      this.tickCount += 1;
      await this.runCadencedTask(this.options.optimizeSkills, this.options.skillOptimizationEveryTicks);
      await this.runCadencedTask(this.options.generateEvalCases, this.options.evalCaseGenerationEveryTicks);
    } finally {
      this.running = false;
    }
  }

  /**
   * Run a best-effort post-metabolism task on a tick cadence. A throwing task
   * never stops the metabolism timer — these tasks log their own failures.
   */
  private async runCadencedTask(
    task: ((options: { project?: string }) => Promise<unknown> | unknown) | undefined,
    everyTicks: number | undefined,
  ): Promise<void> {
    if (!task) return;
    const cadence = Math.max(1, everyTicks ?? 1);
    if (this.tickCount % cadence !== 0) return;
    try {
      await task({ project: this.options.project });
    } catch {
      // Best-effort; swallow so one optional task can't break the loop.
    }
  }
}
