import type { EvalCase, EvalCaseKind, EvalRunResult } from '@mindstrate/protocol';
import { TeamDomainClient } from './team-domain-client.js';

export class EvalClient extends TeamDomainClient {
  async listCases(options?: { kind?: EvalCaseKind }): Promise<EvalCase[]> {
    const query = options?.kind ? `?kind=${encodeURIComponent(options.kind)}` : '';
    const response = await this.fetch<{ cases: EvalCase[] }>(`/api/eval/cases${query}`);
    return response.cases;
  }

  async addCase(input: {
    query: string;
    expectedIds: string[];
    language?: string;
    framework?: string;
    kind?: EvalCaseKind;
  }): Promise<EvalCase> {
    return this.post<EvalCase>('/api/eval/cases', input);
  }

  async deleteCase(id: string): Promise<{ deleted: boolean }> {
    const response = await this.request(`/api/eval/cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return response.json() as Promise<{ deleted: boolean }>;
  }

  async run(options?: { topK?: number; kind?: EvalCaseKind }): Promise<EvalRunResult> {
    return this.post<EvalRunResult>('/api/eval/run', options ?? {});
  }
}
