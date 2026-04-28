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
const TEST_API_KEY = 'test-team-key';

const startTeamServer = async (options?: {
  apiKey?: string;
  clientApiKey?: string;
  projects?: string[];
}): Promise<RunningTeamServer> => {
  const tempDir = createTempDir('mindstrate-team-server-test-');
  const memory = new Mindstrate({ dataDir: tempDir, openaiApiKey: '' });
  await memory.init();

  const apiKey = options?.apiKey ?? TEST_API_KEY;
  const app = createApp({
    apiKey,
    memory,
    authKeys: [{
      key: apiKey,
      scopes: ['read', 'write', 'admin'],
      projects: options?.projects,
    }],
  });
  const server = await new Promise<Server>((resolve) => {
    const instance = createServer(app);
    instance.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const address = server.address() as AddressInfo;
  const client = new TeamClient({
    serverUrl: `http://127.0.0.1:${address.port}`,
    apiKey: options?.clientApiKey ?? apiKey,
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
  it('rejects unauthenticated team API requests', async () => {
    const { client } = await startTeamServer({ clientApiKey: '' });

    await expect(client.knowledge.list()).rejects.toThrow(/401/);
  });

  it('prevents scoped API keys from reading outside their project', async () => {
    const { client, memory } = await startTeamServer({ projects: ['proj-a'] });

    await memory.add(makeKnowledgeInput({
      title: 'Project A workflow',
      type: KnowledgeType.WORKFLOW,
      solution: 'Only project A members should read this workflow.',
      context: { project: 'proj-a' },
    }));
    await memory.add(makeKnowledgeInput({
      title: 'Project B workflow',
      type: KnowledgeType.WORKFLOW,
      solution: 'Project B guidance must stay isolated from project A keys.',
      context: { project: 'proj-b' },
    }));

    const visible = await client.knowledge.list({ project: 'proj-a' });
    expect(visible.map((entry) => entry.title)).toContain('Project A workflow');

    await expect(client.knowledge.list({ project: 'proj-b' })).rejects.toThrow(/403/);
  });

  it('preserves actionable guidance through the HTTP create path', async () => {
    const { client, memory } = await startTeamServer();

    const result = await client.knowledge.add(makeKnowledgeInput({
      type: KnowledgeType.WORKFLOW,
      title: 'Rotate deployment secret',
      solution: 'Follow the rotation workflow.',
      actionable: {
        preconditions: ['Production access approved'],
        steps: ['Disable current secret', 'Create new secret', 'Roll restart services'],
        verification: 'Confirm all services authenticate with the new secret.',
        antiPatterns: ['Do not rotate secrets during an outage'],
      },
    }));

    expect(result.success).toBe(true);
    const stored = memory.listContextNodes({ limit: 50 })
      .find((node) => node.id === result.view!.id);
    expect(stored?.metadata?.['actionable']).toMatchObject({
      steps: [
        'Disable current secret',
        'Create new secret',
        'Roll restart services',
      ],
      verification: 'Confirm all services authenticate with the new secret.',
    });
    expect(result.view?.summary).toBe('Follow the rotation workflow.');
  });

  it('preserves quality warnings through the HTTP create path', async () => {
    const { client } = await startTeamServer();

    const result = await client.knowledge.add(makeKnowledgeInput({
      title: 'Needs language warning',
      solution: 'This entry intentionally omits the programming language metadata.',
      context: {
        project: 'quality-warning-project',
      },
    }));

    expect(result.success).toBe(true);
    expect(result.qualityWarnings).toContain('No programming language specified');
  });

  it('accepts emergent custom knowledge types in team mode', async () => {
    const { client, memory } = await startTeamServer();

    const result = await client.knowledge.add(makeKnowledgeInput({
      type: 'incident_review' as KnowledgeType,
      title: 'Capture incident review learnings',
      solution: 'Record the timeline, contributing factors, and prevention follow-ups.',
      tags: ['incident'],
    }));

    expect(result.success).toBe(true);
    const stored = memory.listContextNodes({ limit: 50 })
      .find((node) => node.id === result.view!.id);
    expect(stored?.metadata?.['knowledgeType']).toBe('incident_review');
  });

  it('restores active sessions and supports richer filters in team mode', async () => {
    const { client, memory } = await startTeamServer();

    const started = await client.sessions.start('proj-a', 'typescript');
    const active = await client.sessions.getActive('proj-a');
    const loaded = await client.sessions.get(started.session.id);

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

    const filtered = await client.knowledge.list({
      types: [KnowledgeType.WORKFLOW, KnowledgeType.BEST_PRACTICE],
      tags: ['rotation'],
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Workflow entry');
  });

  it('runs staged metabolism through the team HTTP API', async () => {
    const { client } = await startTeamServer();

    await client.knowledge.add(makeKnowledgeInput({
      title: 'Digestible team rule',
      type: KnowledgeType.CONVENTION,
      solution: 'Team staged metabolism should expose digest as a first-class operation.',
      context: { project: 'proj-stage' },
    }));

    const digest = await client.metabolism.runStage('digest', { project: 'proj-stage' });

    expect(digest.stage).toBe('digest');
    expect(digest.scanned).toBeGreaterThan(0);
  });

  it('lists ECS projection records through the team HTTP API', async () => {
    const { client } = await startTeamServer();

    await client.knowledge.add(makeKnowledgeInput({
      title: 'Projected team rule',
      type: KnowledgeType.CONVENTION,
      solution: 'Team APIs should expose ECS projection records for observability.',
      context: { project: 'proj-projection' },
    }));

    const records = await client.context.listProjectionRecords({ target: 'graph_knowledge' });

    expect(records.length).toBeGreaterThan(0);
    expect(records[0].target).toBe('graph_knowledge');
  });

  it('publishes portable bundles through the team HTTP API', async () => {
    const { client, tempDir } = await startTeamServer();

    await client.knowledge.add(makeKnowledgeInput({
      title: 'Publishable team rule',
      type: KnowledgeType.CONVENTION,
      solution: 'Team bundle publication should produce a portable manifest.',
      context: { project: 'proj-bundle' },
    }));

    const bundle = await client.bundles.create({
      name: 'team-ecs-rules',
      project: 'proj-bundle',
    });
    const publication = await client.bundles.publish(bundle, {
      registry: 'https://registry.example.test/mindstrate',
      visibility: 'public',
    });

    expect(publication.bundle.id).toBe(bundle.id);
    expect(publication.manifest.name).toBe('team-ecs-rules');
    expect(publication.manifest.registry).toBe('https://registry.example.test/mindstrate');
    expect(publication.manifest.visibility).toBe('public');
    expect(publication.manifest.nodeCount).toBeGreaterThan(0);
    expect(publication.manifest.digest).toMatch(/^sha256:/);

    const registryDir = path.join(tempDir, 'team-registry');
    const localPublication = await client.bundles.publish(bundle, {
      registry: registryDir,
      visibility: 'public',
    });
    const install = await client.bundles.installFromRegistry({
      registry: registryDir,
      reference: `${localPublication.manifest.name}@${localPublication.manifest.version}`,
    });

    expect(fs.existsSync(path.join(registryDir, 'index.json'))).toBe(true);
    expect(install.updatedNodes + install.installedNodes).toBeGreaterThan(0);
  });

  it('generates internalization suggestions through the team HTTP API', async () => {
    const { client, memory } = await startTeamServer();

    memory.createContextNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Review ECS changes with tests',
      content: 'Run focused tests before publishing ECS runtime changes.',
      project: 'proj-internalize',
      status: ContextNodeStatus.VERIFIED,
      qualityScore: 95,
      confidence: 0.95,
    });

    const suggestions = await client.bundles.generateInternalizationSuggestions({
      project: 'proj-internalize',
    });

    expect(suggestions.agentsMd).toContain('Review ECS changes with tests');
    expect(suggestions.systemPromptFragment).toContain('Run focused tests before publishing ECS runtime changes.');
    expect(suggestions.sourceNodeIds).toHaveLength(1);
  });

  it('exports obsidian projection files through the team HTTP API', async () => {
    const { client, memory, tempDir } = await startTeamServer();

    memory.createContextNode({
      substrateType: SubstrateType.RULE,
      domainType: ContextDomainType.CONVENTION,
      title: 'Export ECS rule',
      content: 'Team API should write verified ECS rules as markdown projections.',
      project: 'proj-obsidian',
      status: ContextNodeStatus.VERIFIED,
    });

    const rootDir = path.join(tempDir, 'vault');
    const result = await client.context.writeObsidianProjectionFiles({
      project: 'proj-obsidian',
      rootDir,
    });

    expect(result.files).toHaveLength(1);
    expect(fs.readFileSync(result.files[0], 'utf8')).toContain('Team API should write verified ECS rules');
  });
});


