import type { ApiKey, CreateApiKeyInput, CreateKnowledgeInput, EvolutionRunResult, ListProjectsResponse } from '@mindstrate/protocol';
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

  async listProjects(): Promise<ListProjectsResponse> {
    return this.fetch('/api/projects');
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

  async listApiKeys(): Promise<ApiKey[]> {
    const response = await this.fetch<{ keys: ApiKey[] }>('/api/admin/keys');
    return response.keys;
  }

  async createApiKey(input: CreateApiKeyInput): Promise<ApiKey> {
    return this.post<ApiKey>('/api/admin/keys', input);
  }

  async revokeApiKey(id: string): Promise<{ revoked: boolean }> {
    const response = await this.request(`/api/admin/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      throw new Error(`Failed to revoke API key (${response.status})`);
    }
    return response.json() as Promise<{ revoked: boolean }>;
  }
}
