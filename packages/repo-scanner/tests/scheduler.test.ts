import { describe, expect, it } from 'vitest';
import { RepoScannerDaemon } from '../src/scheduler.js';

describe('RepoScannerDaemon', () => {
  it('runs an immediate tick when started so newly configured sources begin work promptly', async () => {
    let runs = 0;
    const service = {
      scanner: {
        listDueSources: () => [{ id: 'source-1' }],
      },
      runSource: async () => {
        runs++;
        return {
          sourceId: 'source-1',
          mode: 'initialized',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
        };
      },
    };

    const daemon = new RepoScannerDaemon(service as any, { tickMs: 60_000 });
    daemon.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await daemon.stop();

    expect(runs).toBe(1);
  });

  it('isolates a failing source: the error is reported and remaining due sources still run', async () => {
    const ran: string[] = [];
    const errors: Array<{ sourceId: string; message: string }> = [];
    const service = {
      scanner: {
        listDueSources: () => [{ id: 'bad' }, { id: 'good' }],
      },
      runSource: async (id: string) => {
        if (id === 'bad') throw new Error('p4 connect refused');
        ran.push(id);
        return {
          sourceId: id,
          mode: 'incremental',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
        };
      },
    };

    const daemon = new RepoScannerDaemon(service as any, {
      tickMs: 60_000,
      onSourceError: (sourceId, message) => errors.push({ sourceId, message }),
    });

    const results = await daemon.tick();

    expect(ran).toEqual(['good']);
    expect(results).toHaveLength(1);
    expect(errors).toEqual([{ sourceId: 'bad', message: 'p4 connect refused' }]);
  });

  it('stop() waits for the in-flight tick so the store can be closed safely afterwards', async () => {
    let finished = false;
    const service = {
      scanner: {
        listDueSources: () => [{ id: 'slow' }],
      },
      runSource: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        finished = true;
        return {
          sourceId: 'slow',
          mode: 'incremental',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
        };
      },
    };

    const daemon = new RepoScannerDaemon(service as any, { tickMs: 60_000 });
    daemon.start();
    await daemon.stop();

    expect(finished).toBe(true);
  });

  it('skips overlapping ticks while one is still running', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const service = {
      scanner: {
        listDueSources: () => [{ id: 'slow' }],
      },
      runSource: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrent--;
        return {
          sourceId: 'slow',
          mode: 'incremental',
          itemsSeen: 0,
          itemsImported: 0,
          itemsSkipped: 0,
          itemsFailed: 0,
        };
      },
    };

    const daemon = new RepoScannerDaemon(service as any, { tickMs: 60_000 });
    const first = daemon.tick();
    const second = await daemon.tick();
    await first;

    expect(second).toEqual([]);
    expect(maxConcurrent).toBe(1);
  });
});
