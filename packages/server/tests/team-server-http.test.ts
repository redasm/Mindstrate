import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ContextDomainType,
  ContextNodeStatus,
  Mindstrate,
  KnowledgeType,
  SubstrateType,
} from '../src/index.js';
import { createApp } from '../../team-server/src/app.js';
import { TeamClient } from '../../client/src/team-client.js';
import { createTempDir, makeKnowledgeInput, removeTempDir } from './helpers.js';

interface RunningTeamServer {
  close: () => Promise<void>;
  memory: Mindstrate;
  client: TeamClient;
  tempDir: string;
}

const runningServers: RunningTeamServer[] = [];

const startTeamServer = async (): Promise<RunningTeamServer> => {
  const tempDir = createTempDir('mindstrate-team-server-test-');
  const memory = new Mindstrate({ dataDir: tempDir, openaiApiKey: '' });
  await memory.init();

  const app = createApp({ apiKey: '', memory });
  const server = await new Promise<Server>((resolve) => {
    const instance = createServer(app);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address() as AddressInfo;
  const client = new TeamClient({
    serverUrl: `http://127.0.0.1:${address.port}`,
    timeout: 5000,
  });

  const running: RunningTeamServer = {
    memory,
    client,
    tempDir,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
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

describe('team-server HTTP integration', () => {
  it('preserves actionable guidance through the HTTP create path', async () => {
    const { client, memory } = await startTeamServer();

    const result = await client.add(makeKnowledgeInput({
      type: KnowledgeType.WORKFLOW,
      title: 'Rotate deployment secret',
      solution: 'Follow the rotation workflow.',
      actionable: {
        preconditions: ['Production access approved'],
        steps: ['Disable old secret', 'Create new secret', 'Roll restart services'],
        verification: 'Confirm all services authenticate with the new secret.',
        antiPatterns: ['Do not rotate secrets during an outage'],
      },
    }));

    expect(result.success).toBe(true);
    const stored = memory.get(result.knowledge!.id);
    expect(stored?.actionable?.steps).toEqual([
      'Disable old secret',
      'Create new secret',
      'Roll restart services',
    ]);
    expect(stored?.actionable?.verification).toBe(
      'Confirm all services authenticate with the new secret.',
    );
  });

  it('restores active sessions and supports richer filters in team mode', async () => {
    const { client, memory } = await startTeamServer();

    const started = await client.startSession('proj-a', 'typescript');
    const active = await client.getActiveSession('proj-a');
    const loaded = await client.getSession(started.session.id);

    expect(active?.id).toBe(started.session.id);
    expect(loaded?.id).toBe(started.session.id);

    await memory.add(makeKnowledgeInput({
      title: 'Workflow entry',
      type: KnowledgeType.WORKFLOW,
      tags: ['ops', 'rotation'],
      solution: 'Rotate the token with the approved workflow.',
    }));
    await memory.add(makeKnowledgeInput({
      title: 'Best practice entry',
      type: KnowledgeType.BEST_PRACTICE,
      tags: ['frontend'],
      solution: 'Avoid global mutable state in render paths.',
    }));

    const filtered = await client.list({
      types: [KnowledgeType.WORKFLOW, KnowledgeType.BEST_PRACTICE],
      tags: ['rotation'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Workflow entry');
  });

  it('publishes portable bundles through the team HTTP API', async () => {
    const { client } = await startTeamServer();

    await client.add(makeKnowledgeInput({
      title: 'Publishable team rule',
      type: KnowledgeType.CONVENTION,
      solution: 'Team bundle publication should produce a portable manifest.',
      context: { project: 'proj-bundle' },
    }));

    const bundle = await client.createBundle({
      name: 'team-ecs-rules',
      project: 'proj-bundle',
    });
    const publication = await client.publishBundle(bundle, {
      registry: 'https://registry.example.test/mindstrate',
      visibility: 'public',
    });

    expect(publication.bundle.id).toBe(bundle.id);
    expect(publication.manifest.name).toBe('team-ecs-rules');
    expect(publication.manifest.registry).toBe('https://registry.example.test/mindstrate');
    expect(publication.manifest.visibility).toBe('public');
    expect(publication.manifest.nodeCount).toBeGreaterThan(0);
    expect(publication.manifest.digest).toMatch(/^sha256:/);
  });

  it('generates internalization suggestions through the team HTTP API', async () => {
    const { client, memory } = await startTeamServer();
    const internal = memory as unknown as {
      contextGraphStore: {
        createNode(input: Record<string, unknown>): { id: string };
      };
    };

    internal.contextGraphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Review ECS changes with tests',
      content: 'Run focused tests before publishing ECS runtime changes.',
      project: 'proj-internalize',
      status: ContextNodeStatus.VERIFIED,
      qualityScore: 95,
      confidence: 0.95,
    });

    const suggestions = await client.generateInternalizationSuggestions({
      project: 'proj-internalize',
    });

    expect(suggestions.agentsMd).toContain('Review ECS changes with tests');
    expect(suggestions.systemPromptFragment).toContain('Run focused tests before publishing ECS runtime changes.');
    expect(suggestions.sourceNodeIds).toHaveLength(1);
  });

  it('exports obsidian projection files through the team HTTP API', async () => {
    const { client, memory, tempDir } = await startTeamServer();
    const internal = memory as unknown as {
      contextGraphStore: {
        createNode(input: Record<string, unknown>): { id: string };
      };
    };

    internal.contextGraphStore.createNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Export ECS rule',
      content: 'Team API should write verified ECS rules as markdown projections.',
      project: 'proj-obsidian',
      status: ContextNodeStatus.VERIFIED,
    });

    const rootDir = path.join(tempDir, 'vault');
    const result = await client.writeObsidianProjectionFiles({
      project: 'proj-obsidian',
      rootDir,
    });

    expect(result.files).toHaveLength(1);
    expect(fs.readFileSync(result.files[0], 'utf8')).toContain('Team API should write verified ECS rules');
  });
});
