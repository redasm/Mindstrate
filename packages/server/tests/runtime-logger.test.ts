import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Mindstrate, type Logger } from '../src/index.js';

const createCapturingLogger = (): { logger: Logger; entries: Array<{ level: string; message: string }> } => {
  const entries: Array<{ level: string; message: string }> = [];
  return {
    logger: {
      warn: (message) => entries.push({ level: 'warn', message }),
      error: (message) => entries.push({ level: 'error', message }),
      info: (message) => entries.push({ level: 'info', message }),
      debug: (message) => entries.push({ level: 'debug', message }),
    },
    entries,
  };
};

describe('runtime logger injection', () => {
  it('routes session-compressor LLM failures through the injected logger instead of console', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindstrate-logger-'));
    const { logger, entries } = createCapturingLogger();
    const memory = new Mindstrate({
      dataDir,
      // Force an LLM call so we can observe the failure path; compress will
      // fall back to rule-based after the warn is emitted.
      openaiApiKey: 'sk-invalid',
      openaiBaseUrl: 'http://127.0.0.1:1', // unreachable
      logger,
    });
    await memory.init();
    try {
      const session = await memory.sessions.startSession({ project: 'logger-demo' });
      memory.sessions.saveObservation({
        sessionId: session.id,
        type: 'task_start',
        content: 'demonstrate logger injection',
      });

      await memory.sessions.autoCompressSession(session.id);

      const compressorWarnings = entries.filter((entry) =>
        entry.level === 'warn' && entry.message.includes('SessionCompressor'),
      );
      expect(compressorWarnings.length).toBeGreaterThan(0);
    } finally {
      memory.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
