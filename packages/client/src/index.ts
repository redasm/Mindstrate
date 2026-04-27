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
  type TeamServerStats,
  type NodeFeedbackStats,
  type SyncResult,
} from './team-client.js';
