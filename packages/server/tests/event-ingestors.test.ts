import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextGraphStore } from '../src/context-graph/context-graph-store.js';
import { ingestGitActivity, ingestLspDiagnostic, ingestTerminalOutput, ingestTestRun, ingestUserFeedback } from '../src/events/index.js';
import { createTempDir, removeTempDir } from './helpers.js';
import { ContextEventType } from '@mindstrate/protocol/models';

describe('event ingestors', () => {
  let tempDir: string;
  let graphStore: ContextGraphStore;

  beforeEach(() => {
    tempDir = createTempDir();
    graphStore = new ContextGraphStore(path.join(tempDir, 'ingestors.db'));
  });

  afterEach(() => {
    graphStore.close();
    removeTempDir(tempDir);
  });

  it('maps typed ingestors to the expected event types', () => {
    const git = ingestGitActivity(graphStore, { content: 'Updated branch after merge', project: 'mindstrate' });
    const testRun = ingestTestRun(graphStore, { content: 'Vitest failure in context graph tests', project: 'mindstrate' });
    const lsp = ingestLspDiagnostic(graphStore, { content: 'Type error in mindstrate.ts', project: 'mindstrate' });
    const terminal = ingestTerminalOutput(graphStore, {
      content: 'npm test failed with exit code 1',
      project: 'mindstrate',
      command: 'npm test',
      exitCode: 1,
    });
    const feedback = ingestUserFeedback(graphStore, { retrievalId: 'ret-1', signal: 'adopted', project: 'mindstrate' });

    expect(git.event.type).toBe(ContextEventType.GIT_ACTIVITY);
    expect(testRun.event.type).toBe(ContextEventType.TEST_RESULT);
    expect(lsp.event.type).toBe(ContextEventType.LSP_DIAGNOSTIC);
    expect(terminal.event.type).toBe(ContextEventType.TERMINAL_OUTPUT);
    expect(terminal.node.tags).toContain('terminal-output');
    expect(terminal.node.metadata?.['command']).toBe('npm test');
    expect(feedback.event.type).toBe(ContextEventType.FEEDBACK_SIGNAL);
  });
});
