/**
 * Server-side processing result types that cross the wire.
 *
 * These are the contract between a Mindstrate server and any of its
 * clients (CLI, MCP server, web UI, third-party). They must stay
 * implementation-agnostic — no SQLite, no embedder, no LLM types here.
 */

import type { UpdateKnowledgeInput } from './models/knowledge.js';
import type { GraphKnowledgeView } from './models/projection.js';

/**
 * Outcome of writing a single knowledge unit through the server pipeline
 * (quality gate -> dedup -> embed -> persist).
 */
export interface PipelineResult {
  success: boolean;
  view?: GraphKnowledgeView;
  message: string;
  /** When success=false because of dedup, the existing knowledge id. */
  duplicateOf?: string;
  /** Non-blocking warnings produced by the quality gate. */
  qualityWarnings?: string[];
}

/** Pre-write structural validation result (no persistence). */
export interface QualityGateResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  /** Structural completeness score 0-100. */
  completenessScore: number;
}

/** A single recommendation produced by the knowledge-evolution engine. */
export interface EvolutionSuggestion {
  knowledgeId: string;
  type: 'merge' | 'improve' | 'validate' | 'deprecate' | 'split';
  description: string;
  /** Confidence 0-1 */
  confidence: number;
  /** When applicable, the proposed edit. */
  suggestedUpdate?: UpdateKnowledgeInput;
  /** Related knowledge ids (e.g. merge sources). */
  relatedIds?: string[];
}

export type EvolutionRunMode = 'standard' | 'background';

export interface EvolutionSuggestionSummary {
  merge: number;
  improve: number;
  validate: number;
  deprecate: number;
  split: number;
}

/** Aggregate result of one evolution run. */
export interface EvolutionRunResult {
  /** Execution mode for the run. */
  mode: EvolutionRunMode;
  /** How many knowledge entries were scanned. */
  scanned: number;
  /** Suggestions generated. */
  suggestions: EvolutionSuggestion[];
  /** Categorized suggestion counts for lightweight reporting. */
  summary: EvolutionSuggestionSummary;
  /** How many improve suggestions were enhanced by an LLM. */
  llmEnhanced: number;
  /** How many suggestions were auto-applied (when autoApply=true). */
  autoApplied: number;
  /** How many suggestions still need human review. */
  pendingReview: number;
}
