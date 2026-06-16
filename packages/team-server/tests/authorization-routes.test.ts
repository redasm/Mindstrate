import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  Mindstrate,
  ProjectGraphOverlayKind,
  ProjectGraphOverlaySource,
  SubstrateType,
} from '@mindstrate/server';
import { TeamClient } from '@mindstrate/client';
import { createApp } from '../src/app.js';
import { createTempDir, makeKnowledgeInput, removeTempDir } from './test-support.js';

interface RunningTeamServer {
  close: () => Promise<void>;
  memory: Mindstrate;
  client: TeamClient;
  baseUrl: string;
  apiKey: string;
}

const runningServers: RunningTeamServer[] = [];

const startTeamServer = async (options?: {
  apiKey?: string;
  projects?: string[];
  scopes?: Array<'read' | 'write' | 'admin'>;
}): Promise<RunningTeamServer> => {
  const tempDir = createTempDir('mindstrate-authz-test-');
  const memory = new Mindstrate({ dataDir: tempDir });
  await memory.init();

  const adminKey = options?.apiKey ?? 'test-admin-key';
  let clientKey = adminKey;
  if (options?.projects && !(options.projects.length === 1 && options.projects[0] === '*')) {
    const memberKey = memory.apiKeys.create({
      name: 'test-member',
      scopes: options?.scopes ?? ['read', 'write', 'admin'],
      projects: options.projects,
    });
    clientKey = memberKey.key;
  }

  const app = createApp({ adminKey, memory });
  const server = await new Promise<Server>((resolve) => {
    const instance = createServer(app);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const client = new TeamClient({ serverUrl: baseUrl, apiKey: clientKey, timeout: 5000 });

  const running: RunningTeamServer = {
    memory,
    client,
    baseUrl,
    apiKey: clientKey,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      memory.close();
      removeTempDir(tempDir);
    },
  };

  runningServers.push(running);
  return running;
};

afterEach(async () => {
  while (runningServers.length > 0) {
    const running = runningServers.pop();
    if (!running) break;
    await running.close();
  }
});

describe('GET /api/projects', () => {
  it('returns wildcard list for wildcard keys', async () => {
    const { client, memory } = await startTeamServer({ projects: ['*'] });
    await memory.knowledge.add(makeKnowledgeInput({
      title: 'Alpha entry',
      context: { project: 'alpha' },
    }));
    await memory.knowledge.add(makeKnowledgeInput({
      title: 'Beta entry',
      context: { project: 'beta' },
    }));

    const result = await client.admin.listProjects();
    expect(result.wildcard).toBe(true);
    expect(result.projects).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('returns principal whitelist for scoped keys, no DB read', async () => {
    const { client, memory } = await startTeamServer({ projects: ['proj-a', 'proj-b'] });
    await memory.knowledge.add(makeKnowledgeInput({
      title: 'Off-scope entry',
      context: { project: 'proj-c' },
    }));

    const result = await client.admin.listProjects();
    expect(result.wildcard).toBe(false);
    expect(result.projects).toEqual(['proj-a', 'proj-b']);
  });

  it('rejects unauthenticated callers with 401', async () => {
    const { baseUrl } = await startTeamServer({ projects: ['proj-a'] });
    const resp = await fetch(`${baseUrl}/api/projects`);
    expect(resp.status).toBe(401);
  });
});

describe('write path ACL enforcement for scoped keys', () => {
  it('rejects DELETE /api/knowledge/:id when the node belongs to another project', async () => {
    const { memory, baseUrl, apiKey } = await startTeamServer({ projects: ['proj-a'] });

    const added = await memory.knowledge.add(makeKnowledgeInput({
      title: 'Owned by B',
      context: { project: 'proj-b' },
    }));
    expect(added.success).toBe(true);

    const resp = await fetch(`${baseUrl}/api/knowledge/${added.view!.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(resp.status).toBe(403);

    const stillThere = memory.context.getContextNode(added.view!.id);
    expect(stillThere?.id).toBe(added.view!.id);
  });

  it('rejects POST /api/context/events when project is outside whitelist', async () => {
    const { client } = await startTeamServer({ projects: ['proj-a'] });

    await expect(client.context.ingestEvent({
      type: ContextEventType.GIT_ACTIVITY,
      title: 'Forbidden write',
      content: 'Should be blocked at ACL.',
      project: 'proj-other',
      domainType: ContextDomainType.CONVENTION,
      substrateType: SubstrateType.SUMMARY,
    })).rejects.toThrow(/403/);
  });

  it('rejects POST /api/context/project-graph/overlays when project is outside whitelist', async () => {
    const { client, memory } = await startTeamServer({ projects: ['proj-a'] });

    memory.context.createContextNode({
      id: 'pg:other:file:src/App.tsx',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src/App.tsx',
      content: 'Owned by another project.',
      project: 'proj-other',
      status: ContextNodeStatus.ACTIVE,
      metadata: { projectGraph: true, kind: 'file' },
    });

    await expect(client.context.createProjectGraphOverlay({
      project: 'proj-other',
      targetNodeId: 'pg:other:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.NOTE,
      content: 'Should be blocked.',
      author: 'tester',
      source: ProjectGraphOverlaySource.MCP,
    })).rejects.toThrow(/403/);
  });

  it('allows the same overlay when project matches the whitelist', async () => {
    const { client, memory } = await startTeamServer({ projects: ['proj-allowed'] });

    memory.context.createContextNode({
      id: 'pg:allowed:file:src/App.tsx',
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.ARCHITECTURE,
      title: 'src/App.tsx',
      content: 'Within the allow-list.',
      project: 'proj-allowed',
      status: ContextNodeStatus.ACTIVE,
      metadata: { projectGraph: true, kind: 'file' },
    });

    const overlay = await client.context.createProjectGraphOverlay({
      project: 'proj-allowed',
      targetNodeId: 'pg:allowed:file:src/App.tsx',
      kind: ProjectGraphOverlayKind.NOTE,
      content: 'OK to land.',
      author: 'tester',
      source: ProjectGraphOverlaySource.MCP,
    });
    expect(overlay.project).toBe('proj-allowed');
  });
});

describe('read path ACL enforcement for scoped keys', () => {
  const get = (baseUrl: string, path: string, apiKey?: string): Promise<Response> =>
    fetch(`${baseUrl}${path}`, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined);

  it('rejects unauthenticated reads with 401 across newly-guarded endpoints', async () => {
    const { baseUrl } = await startTeamServer({ projects: ['proj-a'] });
    for (const path of [
      '/api/session/restore?project=proj-a',
      '/api/session/active?project=proj-a',
      '/api/stats',
      '/api/context/edges',
      '/api/context/projections',
      '/api/graph/knowledge?project=proj-a',
    ]) {
      const resp = await get(baseUrl, path);
      expect(resp.status, path).toBe(401);
    }
  });

  it('rejects GET /api/graph/knowledge for a project outside the whitelist', async () => {
    const { baseUrl, apiKey } = await startTeamServer({ projects: ['proj-a'] });
    const denied = await get(baseUrl, '/api/graph/knowledge?project=proj-b', apiKey);
    expect(denied.status).toBe(403);
    const allowed = await get(baseUrl, '/api/graph/knowledge?project=proj-a', apiKey);
    expect(allowed.status).toBe(200);
  });

  it('rejects GET /api/context/graph for a project outside the whitelist', async () => {
    const { baseUrl, apiKey } = await startTeamServer({ projects: ['proj-a'] });
    const denied = await get(baseUrl, '/api/context/graph?project=proj-b', apiKey);
    expect(denied.status).toBe(403);
    const allowed = await get(baseUrl, '/api/context/graph?project=proj-a', apiKey);
    expect(allowed.status).toBe(200);
  });

  it('rejects GET /api/session/restore + active for a project outside the whitelist', async () => {
    const { baseUrl, apiKey } = await startTeamServer({ projects: ['proj-a'] });
    expect((await get(baseUrl, '/api/session/restore?project=proj-b', apiKey)).status).toBe(403);
    expect((await get(baseUrl, '/api/session/active?project=proj-b', apiKey)).status).toBe(403);
    expect((await get(baseUrl, '/api/session/restore?project=proj-a', apiKey)).status).toBe(200);
  });

  it('rejects GET /api/session/:id when the session belongs to another project', async () => {
    const { baseUrl, apiKey, memory } = await startTeamServer({ projects: ['proj-a'] });
    const session = await memory.sessions.startSession({ project: 'proj-b' });
    const denied = await get(baseUrl, `/api/session/${session.id}`, apiKey);
    expect(denied.status).toBe(403);
  });

  it('allows wildcard keys to read across projects', async () => {
    const { baseUrl, apiKey } = await startTeamServer({ projects: ['*'] });
    expect((await get(baseUrl, '/api/graph/knowledge?project=anything', apiKey)).status).toBe(200);
    expect((await get(baseUrl, '/api/stats', apiKey)).status).toBe(200);
  });
});
