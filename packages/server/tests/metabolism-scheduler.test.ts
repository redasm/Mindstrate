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

  it('runs skill optimization on the configured tick cadence after metabolism', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const optimizeSkills = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MetabolismScheduler({
      project: 'mindstrate',
      intervalMs: 1000,
      runMetabolism,
      optimizeSkills,
      skillOptimizationEveryTicks: 3,
    });

    scheduler.start();
    // 3 ticks -> metabolism each tick, skill-opt only on the 3rd.
    await vi.advanceTimersByTimeAsync(3000);
    scheduler.stop();

    expect(runMetabolism).toHaveBeenCalledTimes(3);
    expect(optimizeSkills).toHaveBeenCalledTimes(1);
    expect(optimizeSkills).toHaveBeenCalledWith({ project: 'mindstrate' });

    vi.useRealTimers();
  });

  it('does not run skill optimization when no optimizer is configured', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MetabolismScheduler({ intervalMs: 1000, runMetabolism });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.stop();

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps the metabolism timer alive when skill optimization throws', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const optimizeSkills = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new MetabolismScheduler({
      intervalMs: 1000,
      runMetabolism,
      optimizeSkills,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.stop();

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    expect(optimizeSkills).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('generates eval cases on its own cadence, independent of skill optimization', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const optimizeSkills = vi.fn().mockResolvedValue(undefined);
    const generateEvalCases = vi.fn().mockResolvedValue(undefined);
    const scheduler = new MetabolismScheduler({
      project: 'mindstrate',
      intervalMs: 1000,
      runMetabolism,
      optimizeSkills,
      skillOptimizationEveryTicks: 3,
      generateEvalCases,
      evalCaseGenerationEveryTicks: 2,
    });

    scheduler.start();
    // 6 ticks: skill-opt on ticks 3 & 6 (=2), eval-gen on ticks 2,4,6 (=3).
    await vi.advanceTimersByTimeAsync(6000);
    scheduler.stop();

    expect(runMetabolism).toHaveBeenCalledTimes(6);
    expect(optimizeSkills).toHaveBeenCalledTimes(2);
    expect(generateEvalCases).toHaveBeenCalledTimes(3);
    expect(generateEvalCases).toHaveBeenCalledWith({ project: 'mindstrate' });
    vi.useRealTimers();
  });

  it('keeps the metabolism timer alive when eval-case generation throws', async () => {
    vi.useFakeTimers();
    const runMetabolism = vi.fn().mockResolvedValue(undefined);
    const generateEvalCases = vi.fn().mockRejectedValue(new Error('boom'));
    const scheduler = new MetabolismScheduler({
      intervalMs: 1000,
      runMetabolism,
      generateEvalCases,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.stop();

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    expect(generateEvalCases).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('Mindstrate metabolism scheduling', () => {
  it('starts and stops a scheduled metabolism loop from the facade', async () => {
    vi.useFakeTimers();
    const memory = new Mindstrate();
    const runMetabolism = vi.spyOn(memory.metabolism, 'runMetabolism').mockResolvedValue({} as any);

    memory.metabolism.startMetabolismScheduler({
      project: 'mindstrate',
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    memory.metabolism.stopMetabolismScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(1);
    expect(runMetabolism).toHaveBeenCalledWith({
      project: 'mindstrate',
      trigger: 'scheduled',
    });

    memory.close();
    vi.useRealTimers();
  });

  it('fans out a blank-project schedule across every project with data', async () => {
    vi.useFakeTimers();
    const memory = new Mindstrate();
    const runMetabolism = vi.spyOn(memory.metabolism, 'runMetabolism').mockResolvedValue({} as any);
    vi.spyOn((memory as any).services.contextGraphStore, 'listKnownProjects')
      .mockReturnValue(['alpha', 'beta']);

    // No project configured -> "all projects".
    memory.metabolism.startMetabolismScheduler({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    memory.metabolism.stopMetabolismScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    expect(runMetabolism).toHaveBeenCalledWith({ project: 'alpha', trigger: 'scheduled' });
    expect(runMetabolism).toHaveBeenCalledWith({ project: 'beta', trigger: 'scheduled' });

    memory.close();
    vi.useRealTimers();
  });

  it('runs a single undefined pass when no project is configured and the graph is empty', async () => {
    vi.useFakeTimers();
    const memory = new Mindstrate();
    const runMetabolism = vi.spyOn(memory.metabolism, 'runMetabolism').mockResolvedValue({} as any);
    vi.spyOn((memory as any).services.contextGraphStore, 'listKnownProjects')
      .mockReturnValue([]);

    memory.metabolism.startMetabolismScheduler({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    memory.metabolism.stopMetabolismScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(1);
    expect(runMetabolism).toHaveBeenCalledWith({ project: undefined, trigger: 'scheduled' });

    memory.close();
    vi.useRealTimers();
  });

  it('keeps fanning out when one project throws', async () => {
    vi.useFakeTimers();
    const memory = new Mindstrate();
    const runMetabolism = vi.spyOn(memory.metabolism, 'runMetabolism')
      .mockImplementation(async ({ project }: any) => {
        if (project === 'alpha') throw new Error('boom');
        return {} as any;
      });
    vi.spyOn((memory as any).services.contextGraphStore, 'listKnownProjects')
      .mockReturnValue(['alpha', 'beta']);

    memory.metabolism.startMetabolismScheduler({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    memory.metabolism.stopMetabolismScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runMetabolism).toHaveBeenCalledTimes(2);
    expect(runMetabolism).toHaveBeenCalledWith({ project: 'beta', trigger: 'scheduled' });

    memory.close();
    vi.useRealTimers();
  });
});
