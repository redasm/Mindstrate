/**
 * Regression tests for the memory_feedback / memory_feedback_auto
 * MCP handlers.
 *
 * Before this fix, both tools always returned "Feedback recorded"
 * regardless of whether the supplied retrieval id actually existed in
 * the feedback events table. Typo'd or fabricated ids looked like
 * successful writes to the calling agent even though the underlying
 * `feedbackLoop.recordFeedback` silently bailed on missing rows. That
 * made the feedback counters untrustworthy and impossible to debug.
 *
 * These tests pin the new contract:
 *   - When `api.recordFeedback` returns `true`, the handler returns
 *     a "recorded" message with no `isError` flag.
 *   - When it returns `false`, the handler returns `isError: true`
 *     with a human-readable explanation pointing at the right call
 *     site (context_assemble retrieval tickets).
 */

import { describe, expect, it } from 'vitest';
import { handleMemoryFeedback, handleMemoryFeedbackAuto } from '../src/tools/memory-handlers.js';
import { createFakeMcpApi } from './fake-mcp-api.js';

describe('handleMemoryFeedback (BUG: unknown retrievalId used to fake success)', () => {
  it('reports success when the retrieval id was applied', async () => {
    const api = createFakeMcpApi({});
    api.recordFeedback = async () => true;

    const response = await handleMemoryFeedback(api, {
      id: 'real-retrieval-id',
      signal: 'adopted',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('adopted');
    expect(response.content[0].text).toContain('real-retrieval-id');
  });

  it('returns isError when the retrieval id was unknown', async () => {
    const api = createFakeMcpApi({});
    api.recordFeedback = async () => false;

    const response = await handleMemoryFeedback(api, {
      id: 'not-a-real-id',
      signal: 'adopted',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Unknown retrieval id: not-a-real-id');
    expect(response.content[0].text).toContain('context_assemble');
  });
});

describe('handleMemoryFeedbackAuto (BUG: unknown retrievalId used to fake success)', () => {
  it('reports success when the retrieval id was applied', async () => {
    const api = createFakeMcpApi({});
    api.recordFeedback = async () => true;

    const response = await handleMemoryFeedbackAuto(api, {
      retrievalId: 'real-retrieval-id',
      signal: 'partial',
    });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toContain('partial');
    expect(response.content[0].text).toContain('real-retrieval-id');
  });

  it('returns isError when the retrieval id was unknown, citing the Retrieval Tickets origin', async () => {
    const api = createFakeMcpApi({});
    api.recordFeedback = async () => false;

    const response = await handleMemoryFeedbackAuto(api, {
      retrievalId: 'fabricated-id-xxx',
      signal: 'adopted',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Unknown retrievalId: fabricated-id-xxx');
    // Make sure the error message tells the AI *where* a real
    // retrievalId comes from, so the next call is correct.
    expect(response.content[0].text).toContain('Retrieval Tickets');
    expect(response.content[0].text).toContain('context_assemble');
  });
});
