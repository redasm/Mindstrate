import type {
  AddKnowledgeResult,
  CreateKnowledgeInput,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  RetrievalFilter,
} from '@mindstrate/protocol';
import { errorMessage } from '@mindstrate/protocol/text';
import { TeamDomainClient } from './team-domain-client.js';

export class KnowledgeClient extends TeamDomainClient {
  async add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult> {
    return this.post<AddKnowledgeResult>('/api/knowledge', input);
  }

  async search(query: string, options?: {
    topK?: number;
    filter?: RetrievalFilter;
  }): Promise<GraphKnowledgeSearchResult[]> {
    const data = await this.post<{ results?: GraphKnowledgeSearchResult[] }>('/api/search', {
      query,
      topK: options?.topK ?? 5,
      language: options?.filter?.language,
      framework: options?.filter?.framework,
      project: options?.filter?.project,
      types: options?.filter?.types,
      tags: options?.filter?.tags,
      status: options?.filter?.status,
      minScore: options?.filter?.minScore,
    });
    return data.results ?? [];
  }

  async get(id: string): Promise<GraphKnowledgeView | null> {
    try {
      return await this.fetch<GraphKnowledgeView>(`/api/knowledge/${id}`);
    } catch (err) {
      console.warn(`[KnowledgeClient] Failed to get knowledge ${id}: ${errorMessage(err)}`);
      return null;
    }
  }

  async list(filter?: RetrievalFilter, limit?: number): Promise<GraphKnowledgeView[]> {
    const params = new URLSearchParams();
    for (const type of filter?.types ?? []) params.append('type', type);
    if (filter?.language) params.set('language', filter.language);
    if (filter?.framework) params.set('framework', filter.framework);
    if (filter?.project) params.set('project', filter.project);
    for (const tag of filter?.tags ?? []) params.append('tag', tag);
    for (const status of filter?.status ?? []) params.append('status', status);
    if (filter?.minScore !== undefined) params.set('minScore', String(filter.minScore));
    if (limit) params.set('limit', String(limit));

    const data = await this.fetch<{ entries?: GraphKnowledgeView[] }>(`/api/knowledge?${params}`);
    return data.entries ?? [];
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.request(`/api/knowledge/${id}`, { method: 'DELETE' });
      return true;
    } catch (err) {
      console.warn(`[KnowledgeClient] Failed to delete knowledge ${id}: ${errorMessage(err)}`);
      return false;
    }
  }
}
