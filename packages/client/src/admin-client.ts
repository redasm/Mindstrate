import type { CreateKnowledgeInput, EvolutionRunResult } from '@mindstrate/protocol';
import { TeamDomainClient } from './team-domain-client.js';

export interface TeamServerStats {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byLanguage: Record<string, number>;
  vectorCount: number;
  feedbackStats: {
    totalEvents: number;
    last30Days: number;
    avgAdoptionRate: number;
  };
}

export interface SyncResult {
  imported: number;
  skipped: number;
  failed: number;
}

export class AdminClient extends TeamDomainClient {
  async getStats(): Promise<TeamServerStats> {
    return this.fetch('/api/stats');
  }

  async sync(entries: CreateKnowledgeInput[]): Promise<SyncResult> {
    return this.post('/api/sync', { entries });
  }

  async health(): Promise<boolean> {
    try {
      const data = await this.fetch<{ status?: string }>('/health');
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    return this.post('/api/evolve', options ?? {});
  }
}
