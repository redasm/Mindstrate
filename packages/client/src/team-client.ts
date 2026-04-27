import { AdminClient } from './admin-client.js';
import { BundleClient } from './bundle-client.js';
import { ContextClient } from './context-client.js';
import { FeedbackClient } from './feedback-client.js';
import { KnowledgeClient } from './knowledge-client.js';
import { MetabolismClient } from './metabolism-client.js';
import { SessionClient } from './session-client.js';
import { TeamHttpTransport } from './team-http-transport.js';

export interface TeamClientConfig {
  serverUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class TeamClient {
  readonly admin: AdminClient;
  readonly bundles: BundleClient;
  readonly context: ContextClient;
  readonly feedback: FeedbackClient;
  readonly knowledge: KnowledgeClient;
  readonly metabolism: MetabolismClient;
  readonly sessions: SessionClient;

  constructor(config: TeamClientConfig) {
    const transport = new TeamHttpTransport(config);
    this.admin = new AdminClient(transport);
    this.bundles = new BundleClient(transport);
    this.context = new ContextClient(transport);
    this.feedback = new FeedbackClient(transport);
    this.knowledge = new KnowledgeClient(transport);
    this.metabolism = new MetabolismClient(transport);
    this.sessions = new SessionClient(transport);
  }
}
