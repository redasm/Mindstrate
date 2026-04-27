import { TeamDomainClient } from './team-domain-client.js';

export interface NodeFeedbackStats {
  total: number;
  adopted: number;
  rejected: number;
  ignored: number;
  partial: number;
  adoptionRate: number;
}

export type FeedbackSignal = 'adopted' | 'rejected' | 'ignored' | 'partial';

export class FeedbackClient extends TeamDomainClient {
  async record(retrievalId: string, signal: FeedbackSignal, context?: string): Promise<void> {
    await this.post('/api/feedback', { retrievalId, signal, context });
  }

  async getStats(nodeId: string): Promise<NodeFeedbackStats> {
    return this.fetch(`/api/feedback/${nodeId}`);
  }
}
