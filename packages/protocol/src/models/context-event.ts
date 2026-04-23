/**
 * Backward-compatible ECS event exports.
 *
 * The primary type lives in context-graph.ts because events are part of the
 * substrate graph ingestion model. This file exists to keep the model surface
 * explicit and discoverable.
 */

export {
  ContextEventType,
  isValidContextEventType,
  type ContextEvent,
} from './context-graph.js';
