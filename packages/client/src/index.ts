/**
 * @mindstrate/client
 *
 * HTTP client for talking to a remote Mindstrate Team Server.
 * Pure fetch-based, zero native dependencies — safe to ship to any
 * machine that just needs to read/write knowledge over the network.
 */

export {
  TeamClient,
  type TeamClientConfig,
} from './team-client.js';

export {
  AdminClient,
  type TeamServerStats,
  type SyncResult,
} from './admin-client.js';

export { BundleClient } from './bundle-client.js';
export {
  ContextClient,
  type InternalizationTarget,
  type ObsidianProjectionImportResult,
  type ObsidianProjectionWriteResult,
} from './context-client.js';
export {
  FeedbackClient,
  type FeedbackSignal,
  type NodeFeedbackStats,
} from './feedback-client.js';
export { KnowledgeClient } from './knowledge-client.js';
export {
  MetabolismClient,
  type MetabolismStage,
  type MetabolismStageResult,
} from './metabolism-client.js';
export { SessionClient } from './session-client.js';

export {
  TeamHttpTransport,
  type TeamHttpTransportConfig,
} from './team-http-transport.js';
