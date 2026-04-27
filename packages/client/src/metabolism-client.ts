import type { MetabolismRun } from '@mindstrate/protocol';
import { TeamDomainClient } from './team-domain-client.js';

export type MetabolismStage = 'digest' | 'assimilate' | 'compress' | 'prune' | 'reflect';
export type MetabolismStageResult = {
  stage: MetabolismStage;
  scanned?: number;
} & Record<string, unknown>;

export class MetabolismClient extends TeamDomainClient {
  async run(options?: {
    project?: string;
    trigger?: 'manual' | 'scheduled' | 'event_driven';
  }): Promise<MetabolismRun> {
    return this.post('/api/metabolism/run', options ?? {});
  }

  async runStage(stage: MetabolismStage, options?: { project?: string }): Promise<MetabolismStageResult> {
    return this.post('/api/metabolism/stage', {
      stage,
      project: options?.project,
    });
  }
}
