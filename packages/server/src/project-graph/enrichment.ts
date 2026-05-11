/**
 * Project graph LLM enrichment orchestrator.
 *
 * Decides whether to invoke the summarizer at all (skipping when the LLM
 * is not configured or when extracted facts are unchanged), filters
 * inference results by provenance + evidence quality, and persists
 * surviving nodes/edges via the project graph writer. The expensive
 * pieces — LLM transport, JSON parsing, idempotence cache — live in
 * sibling modules so this file can stay a small policy layer.
 */

import {
  ProjectGraphProvenance,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { ContextNode } from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { writeProjectGraphExtraction } from './graph-writer.js';
import {
  hashExtractedFacts,
  previousEnrichmentInputHash,
  upsertEnrichmentCacheNode,
} from './enrichment-cache.js';
import type { ProjectGraphEnrichmentExtraction } from './enrichment-llm-summarizer.js';

export interface ProjectGraphEnrichmentInput {
  project: string;
  llmConfigured: boolean;
  extractedNodes?: ContextNode[];
  summarize?: () => Promise<ProjectGraphNodeDto[] | ProjectGraphEnrichmentExtraction>;
}

export type ProjectGraphEnrichmentResult =
  | { status: 'skipped'; reason: 'llm_not_configured' | 'summarizer_not_configured'; nodesCreated: 0 }
  | { status: 'noop'; reason?: 'unchanged_input'; nodesCreated: 0; nodesUpdated: 0 }
  | { status: 'enriched'; nodesCreated: number; nodesUpdated: number };

export const enrichProjectGraph = async (
  store: ContextGraphStore,
  input: ProjectGraphEnrichmentInput,
): Promise<ProjectGraphEnrichmentResult> => {
  if (!input.llmConfigured) {
    return { status: 'skipped', reason: 'llm_not_configured', nodesCreated: 0 };
  }
  if (!input.summarize) {
    return { status: 'skipped', reason: 'summarizer_not_configured', nodesCreated: 0 };
  }

  const inputHash = input.extractedNodes ? hashExtractedFacts(input.extractedNodes) : undefined;
  if (inputHash && previousEnrichmentInputHash(store, input.project) === inputHash) {
    return { status: 'noop', reason: 'unchanged_input', nodesCreated: 0, nodesUpdated: 0 };
  }

  const summarized = normalizeEnrichmentExtraction(await input.summarize());
  const nodes = summarized.nodes.filter(isAcceptableInference);
  const edges = summarized.edges.filter(isAcceptableInferredEdge);
  if (inputHash) upsertEnrichmentCacheNode(store, input.project, inputHash);
  if (nodes.length === 0 && edges.length === 0) return { status: 'noop', nodesCreated: 0, nodesUpdated: 0 };

  const writeResult = writeProjectGraphExtraction(store, {
    project: input.project,
    nodes,
    edges,
  });

  return {
    status: 'enriched',
    nodesCreated: writeResult.nodesCreated,
    nodesUpdated: writeResult.nodesUpdated,
  };
};

const isAcceptableInference = (node: ProjectGraphNodeDto): boolean =>
  (node.provenance === ProjectGraphProvenance.INFERRED ||
    node.provenance === ProjectGraphProvenance.AMBIGUOUS) &&
  node.evidence.length > 0;

const isAcceptableInferredEdge = (edge: ProjectGraphEdgeDto): boolean =>
  (edge.provenance === ProjectGraphProvenance.INFERRED ||
    edge.provenance === ProjectGraphProvenance.AMBIGUOUS) &&
  edge.evidence.length > 0;

const normalizeEnrichmentExtraction = (
  value: ProjectGraphNodeDto[] | ProjectGraphEnrichmentExtraction,
): ProjectGraphEnrichmentExtraction => Array.isArray(value)
  ? { nodes: value, edges: [] }
  : value;

export type {
  ProjectGraphEnrichmentExtraction,
  SummarizeProjectGraphWithLlmInput,
} from './enrichment-llm-summarizer.js';
export { summarizeProjectGraphWithLlm } from './enrichment-llm-summarizer.js';
export { LLM_ENRICHMENT_CACHE_TAG } from './enrichment-cache.js';
