export interface TeamHttpTransportConfig {
  serverUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class TeamHttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: TeamHttpTransportConfig) {
    this.baseUrl = config.serverUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey ?? '';
    this.timeout = config.timeout ?? 10000;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request(path, { method: 'GET' }).then((response) => response.json() as Promise<T>);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json() as Promise<T>;
  }

  async request(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> ?? {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await globalThis.fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Team Server error ${response.status}: ${body}`);
      }

      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}
