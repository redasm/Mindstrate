import { describe, expect, it, vi } from 'vitest';
import { Mindstrate } from '../src/mindstrate.js';
import { MetabolismScheduler } from '../src/metabolism/scheduler.js';

describe('MetabolismScheduler', () => {
  it('runs metabolism on the configured interval and stops cleanly', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MetabolismScheduler({
      project: 'mindstrate',
      intervalMs: 1000,
      runMetabolism,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    expect(runMetabolism).toHaveBeenCalledWith({
      project: 'mindstrate',
      trigger: 'scheduled',
    });

    vi.useRealTimers();
  });
});

describe('Mindstrate metabolism scheduling', () => {
  it('starts and stops a scheduled metabolism loop from the facade', async () => {
    vi.useFakeTimers();
    const memory = new Mindstrate();
    const runMetabolism = vi.spyOn(memory, 'runMetabolism').mockResolvedValue({} as any);

    memory.startMetabolismScheduler({
      project: 'mindstrate',
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    memory.stopMetabolismScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(1);
    expect(runMetabolism).toHaveBeenCalledWith({
      project: 'mindstrate',
      trigger: 'scheduled',
    });

    memory.close();
    vi.useRealTimers();
  });
});
