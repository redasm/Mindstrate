import * as os from 'node:os';
import * as path from 'node:path';
import { TeamClient } from '@mindstrate/client';
import {
  CaptureSource,
  ContextDomainType,
  ContextEventType,
  Mindstrate,
  type AddKnowledgeResult,
} from '@mindstrate/server';

export interface KnowledgeSink {
  init(): Promise<void>;
  addKnowledge(input: any): Promise<AddKnowledgeResult>;
  ingestGitActivity(input: {
    content: string;
    project?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  close(): Promise<void>;
}

export function createKnowledgeSink(memory?: Mindstrate): KnowledgeSink {
  if (memory) {
    return new LocalMemorySink(memory, false);
  }

  const teamServerUrl = process.env['TEAM_SERVER_URL'] ?? '';
  if (teamServerUrl) {
    return new TeamServerSink(teamServerUrl);
  }

  return new LocalMemorySink(new Mindstrate(), true);
}

export function defaultScannerDbPath(): string {
  return path.join(os.homedir(), '.mindstrate-scanner', 'scanner.db');
}

class LocalMemorySink implements KnowledgeSink {
  constructor(
    private readonly memory: Mindstrate,
    private readonly ownsMemory: boolean,
  ) {}

  async init(): Promise<void> {
    await this.memory.init();
  }

  async addKnowledge(input: any): Promise<AddKnowledgeResult> {
    return this.memory.add(input);
  }

  async ingestGitActivity(input: Parameters<KnowledgeSink['ingestGitActivity']>[0]): Promise<void> {
    this.memory.ingestGitActivity(input);
  }

  async close(): Promise<void> {
    if (this.ownsMemory) {
      this.memory.close();
    }
  }
}

class TeamServerSink implements KnowledgeSink {
  private readonly client: TeamClient;

  constructor(private readonly teamServerUrl: string) {
    this.client = new TeamClient({
      serverUrl: teamServerUrl,
      apiKey: process.env['TEAM_API_KEY'] ?? '',
    });
  }

  async init(): Promise<void> {
    const healthy = await this.client.admin.health();
    if (!healthy) {
      throw new Error(`Team Server is not reachable: ${this.teamServerUrl}`);
    }
  }

  async addKnowledge(input: any): Promise<AddKnowledgeResult> {
    return this.client.knowledge.add(input);
  }

  async ingestGitActivity(input: Parameters<KnowledgeSink['ingestGitActivity']>[0]): Promise<void> {
    await this.client.context.ingestEvent({
      type: ContextEventType.GIT_ACTIVITY,
      content: input.content,
      project: input.project,
      actor: input.actor ?? 'git',
      domainType: ContextDomainType.ARCHITECTURE,
      substrateType: 'episode',
      title: `git activity: ${input.content.slice(0, 80)}`,
      tags: ['git-activity'],
      metadata: {
        sourceRef: input.sourceRef,
        ...input.metadata,
      },
    });
  }

  async close(): Promise<void> {
    return;
  }
}
