import { TeamHttpTransport } from './team-http-transport.js';

export abstract class TeamDomainClient {
  constructor(protected readonly transport: TeamHttpTransport) {}

  protected fetch<T = unknown>(path: string): Promise<T> {
    return this.transport.get<T>(path);
  }

  protected post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.transport.post<T>(path, body);
  }

  protected request(path: string, init: RequestInit): Promise<Response> {
    return this.transport.request(path, init);
  }
}
