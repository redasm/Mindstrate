import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Mindstrate } from '@mindstrate/server';
import { createApp } from '../src/app.js';
import { createTempDir, removeTempDir } from './test-support.js';

interface RunningServer {
  baseUrl: string;
  adminKey: string;
  memory: Mindstrate;
  close: () => Promise<void>;
}

const runningServers: RunningServer[] = [];

const startServer = async (adminKey = 'admin-bootstrap-key'): Promise<RunningServer> => {
  const tempDir = createTempDir('mindstrate-admin-keys-test-');
  const memory = new Mindstrate({ dataDir: tempDir, openaiApiKey: '' });
  await memory.init();

  const app = createApp({ adminKey, memory });
  const server = await new Promise<Server>((resolve) => {
    const instance = createServer(app);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const running: RunningServer = {
    baseUrl,
    adminKey,
    memory,
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

describe('admin keys routes', () => {
  it('admin can create, list, then revoke a member key', async () => {
    const { baseUrl, adminKey } = await startServer();

    const createResp = await fetch(`${baseUrl}/api/admin/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ name: 'alice', scopes: ['read', 'write'], projects: ['proj-a'] }),
    });
    expect(createResp.status).toBe(201);
    const created = await createResp.json();
    expect(created.name).toBe('alice');
    expect(created.key).toMatch(/^[0-9a-f]{64}$/);

    const listResp = await fetch(`${baseUrl}/api/admin/keys`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(listResp.status).toBe(200);
    const { keys } = await listResp.json();
    expect(keys.map((entry: { id: string }) => entry.id)).toContain(created.id);

    const revokeResp = await fetch(`${baseUrl}/api/admin/keys/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(revokeResp.status).toBe(200);
    expect(await revokeResp.json()).toEqual({ revoked: true });
  });

  it('revoked key cannot authenticate', async () => {
    const { baseUrl, adminKey, memory } = await startServer();
    const member = memory.apiKeys.create({
      name: 'bob',
      scopes: ['read'],
      projects: ['*'],
    });

    const beforeResp = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${member.key}` },
    });
    expect(beforeResp.status).toBe(200);

    memory.apiKeys.revoke(member.id);

    const afterResp = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${member.key}` },
    });
    expect(afterResp.status).toBe(401);

    const adminCheck = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(adminCheck.status).toBe(200);
  });

  it('non-admin member is forbidden from /api/admin/keys', async () => {
    const { baseUrl, memory } = await startServer();
    const member = memory.apiKeys.create({
      name: 'carol',
      scopes: ['read', 'write'],
      projects: ['proj-a'],
    });

    const listResp = await fetch(`${baseUrl}/api/admin/keys`, {
      headers: { Authorization: `Bearer ${member.key}` },
    });
    expect(listResp.status).toBe(403);
  });

  it('rejects requests without bearer token with 401', async () => {
    const { baseUrl } = await startServer();
    const resp = await fetch(`${baseUrl}/api/admin/keys`);
    expect(resp.status).toBe(401);
  });

  it('admin bootstrap key resolves to admin principal even before any member key exists', async () => {
    const { baseUrl, adminKey } = await startServer();
    const resp = await fetch(`${baseUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.wildcard).toBe(true);
  });

  it('rejects bodies with invalid scope/project payloads', async () => {
    const { baseUrl, adminKey } = await startServer();

    const badScopes = await fetch(`${baseUrl}/api/admin/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ name: 'x', scopes: ['bogus'], projects: ['proj-a'] }),
    });
    expect(badScopes.status).toBe(400);

    const noProjects = await fetch(`${baseUrl}/api/admin/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` },
      body: JSON.stringify({ name: 'x', scopes: ['read'], projects: [] }),
    });
    expect(noProjects.status).toBe(400);
  });
});
