import type { Session, SessionContext } from '@mindstrate/protocol';
import { errorMessage } from '@mindstrate/protocol/text';
import { TeamDomainClient } from './team-domain-client.js';

export class SessionClient extends TeamDomainClient {
  async start(project: string = '', techContext?: string): Promise<{ session: Session; context: string | null }> {
    return this.post('/api/session/start', { project, techContext });
  }

  async saveObservation(sessionId: string, type: string, content: string, metadata?: Record<string, string>): Promise<void> {
    await this.post('/api/session/save', { sessionId, type, content, metadata });
  }

  async end(sessionId: string, summary?: string, openTasks?: string[]): Promise<void> {
    await this.post('/api/session/end', { sessionId, summary, openTasks });
  }

  async restore(project: string = ''): Promise<{ context: SessionContext; formatted: string | null }> {
    return this.fetch(`/api/session/restore?project=${encodeURIComponent(project)}`);
  }

  async get(id: string): Promise<Session | null> {
    try {
      return await this.fetch<Session>(`/api/session/${id}`);
    } catch (err) {
      console.warn(`[SessionClient] Failed to get session ${id}: ${errorMessage(err)}`);
      return null;
    }
  }

  async getActive(project: string = ''): Promise<Session | null> {
    try {
      const data = await this.fetch<{ session?: Session | null }>(`/api/session/active?project=${encodeURIComponent(project)}`);
      return data.session ?? null;
    } catch (err) {
      console.warn(`[SessionClient] Failed to get active session for ${project || '(default)'}: ${errorMessage(err)}`);
      return null;
    }
  }
}
