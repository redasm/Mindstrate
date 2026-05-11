/**
 * Wired-together test: KnowledgeClient through TeamHttpTransport with
 * a stubbed fetch. Verifies the HTTP method, URL, body, and response
 * unwrapping for each public method.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeType, CaptureSource } from '@mindstrate/protocol';
import { KnowledgeClient } from '../src/knowledge-client.js';
import { TeamHttpTransport } from '../src/team-http-transport.js';

interface FetchCall {
  url: string;
  init: RequestInit;
}

const installFetchStub = (responder: (url: string, init: RequestInit) => Response): { calls: FetchCall[] } => {
  const calls: FetchCall[] = [];
  globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const initOrEmpty = init ?? {};
    calls.push({ url, init: initOrEmpty });
    return responder(url, initOrEmpty);
  }) as unknown as typeof globalThis.fetch;
  return { calls };
};

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

let originalFetch: typeof globalThis.fetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

const makeClient = () => new KnowledgeClient(new TeamHttpTransport({
  serverUrl: 'http://server:3388',
  apiKey: 'secret',
}));

describe('KnowledgeClient.add', () => {
  it('POSTs the input to /api/knowledge and returns the parsed result', async () => {
    const { calls } = installFetchStub(() => json({ id: 'k1', created: true }));

    const result = await makeClient().add({
      type: KnowledgeType.BUG_FIX,
      title: 't',
      problem: 'p',
      solution: 's',
      tags: [],
      source: CaptureSource.CLI,
      confidence: 0.9,
    });

    expect(calls[0].url).toBe('http://server:3388/api/knowledge');
    expect(calls[0].init.method).toBe('POST');
    expect(result).toEqual({ id: 'k1', created: true });
  });
});

describe('KnowledgeClient.search', () => {
  it('POSTs the query and filter to /api/search and unwraps results', async () => {
    const { calls } = installFetchStub(() => json({ results: [{ view: { id: 'k1' }, score: 0.9 }] }));

    const results = await makeClient().search('how to fix x', {
      topK: 7,
      filter: { project: 'demo', tags: ['typescript'] },
    });

    expect(calls[0].url).toBe('http://server:3388/api/search');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ query: 'how to fix x', topK: 7, project: 'demo', tags: ['typescript'] });
    expect(results).toHaveLength(1);
  });

  it('returns an empty array when the server returns no results field', async () => {
    installFetchStub(() => json({}));

    const results = await makeClient().search('nope');

    expect(results).toEqual([]);
  });
});

describe('KnowledgeClient.get', () => {
  it('GETs /api/knowledge/:id and returns the entry', async () => {
    const { calls } = installFetchStub(() => json({ id: 'k1', title: 't' }));

    const view = await makeClient().get('k1');

    expect(calls[0].url).toBe('http://server:3388/api/knowledge/k1');
    expect(calls[0].init.method).toBe('GET');
    expect(view?.id).toBe('k1');
  });

  it('returns null and logs when the server returns 4xx/5xx', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFetchStub(() => new Response('not found', { status: 404 }));

    const view = await makeClient().get('missing');

    expect(view).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('KnowledgeClient.list', () => {
  it('encodes filters as URL query parameters', async () => {
    const { calls } = installFetchStub(() => json({ entries: [{ id: 'k1' }] }));

    const entries = await makeClient().list({
      project: 'demo',
      tags: ['typescript', 'react'],
      types: [KnowledgeType.BUG_FIX],
    }, 25);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/knowledge');
    expect(url.searchParams.getAll('tag')).toEqual(['typescript', 'react']);
    expect(url.searchParams.getAll('type')).toEqual([KnowledgeType.BUG_FIX]);
    expect(url.searchParams.get('project')).toBe('demo');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(entries).toHaveLength(1);
  });
});

describe('KnowledgeClient.delete', () => {
  it('returns true when the DELETE call succeeds', async () => {
    const { calls } = installFetchStub(() => new Response('{"deleted":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const ok = await makeClient().delete('k1');

    expect(ok).toBe(true);
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('returns false and logs on server error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installFetchStub(() => new Response('boom', { status: 500 }));

    const ok = await makeClient().delete('k1');

    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
