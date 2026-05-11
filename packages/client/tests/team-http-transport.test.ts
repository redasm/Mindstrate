/**
 * Regression tests for `TeamHttpTransport`.
 *
 * Stubs `globalThis.fetch` so the transport is exercised without requiring
 * a live HTTP server. Focuses on contract-level behaviour:
 *   - base URL trimming so callers can mix trailing slashes
 *   - Authorization header attachment when an API key is configured
 *   - JSON body and Content-Type for POST
 *   - error mapping for non-2xx responses (includes status + body in the
 *     thrown message so consumers can log meaningfully)
 *   - timeout / abort behaviour
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamHttpTransport } from '../src/team-http-transport.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const installFetchStub = (response: Response | (() => Response | Promise<Response>)): { calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return typeof response === 'function' ? response() : response;
  });
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return { calls };
};

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('TeamHttpTransport.get', () => {
  it('trims trailing slashes from the configured server URL', async () => {
    const { calls } = installFetchStub(jsonResponse({ ok: true }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388///' });

    await transport.get('/api/health');

    expect(calls[0].url).toBe('http://server:3388/api/health');
  });

  it('attaches a bearer Authorization header when an API key is configured', async () => {
    const { calls } = installFetchStub(jsonResponse({ ok: true }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388', apiKey: 'secret' });

    await transport.get('/api/health');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret');
  });

  it('omits the Authorization header when no API key is configured', async () => {
    const { calls } = installFetchStub(jsonResponse({ ok: true }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388' });

    await transport.get('/api/health');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns the parsed JSON body for 2xx responses', async () => {
    installFetchStub(jsonResponse({ status: 'ok', count: 7 }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388' });

    const result = await transport.get<{ status: string; count: number }>('/api/stats');

    expect(result).toEqual({ status: 'ok', count: 7 });
  });
});

describe('TeamHttpTransport.post', () => {
  it('serialises the body as JSON and sets Content-Type', async () => {
    const { calls } = installFetchStub(jsonResponse({ id: 'k1' }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388', apiKey: 'secret' });

    await transport.post('/api/knowledge', { title: 'x' });

    const init = calls[0].init;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer secret');
    expect(init.body).toBe(JSON.stringify({ title: 'x' }));
  });
});

describe('TeamHttpTransport error mapping', () => {
  it('throws an error including the status code and response body for non-2xx', async () => {
    installFetchStub(new Response('database unavailable', { status: 503 }));
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388' });

    await expect(transport.get('/api/health')).rejects.toThrow(/Team Server error 503: database unavailable/);
  });

  it('still throws when the error body cannot be read as text', async () => {
    const broken = new Response(null, { status: 500 });
    Object.defineProperty(broken, 'text', { value: () => Promise.reject(new Error('boom')) });
    installFetchStub(broken);
    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388' });

    await expect(transport.get('/api/health')).rejects.toThrow(/Team Server error 500/);
  });
});

describe('TeamHttpTransport timeout', () => {
  it('aborts the request after the configured timeout when fetch hangs', async () => {
    let abortReason: unknown;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => {
        abortReason = (init.signal as AbortSignal & { reason?: unknown }).reason ?? new Error('aborted');
        reject(abortReason);
      });
    })) as unknown as typeof globalThis.fetch;

    const transport = new TeamHttpTransport({ serverUrl: 'http://server:3388', timeout: 10 });

    await expect(transport.get('/api/health')).rejects.toBeDefined();
    expect(abortReason).toBeDefined();
  });
});
