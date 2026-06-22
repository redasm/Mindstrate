/**
 * LLM-driven summarizer for project graph enrichment.
 *
 * Owns the full LLM call path: collecting extracted facts, batching them
 * within the request policy, deduping LLM-suggested nodes/edges across
 * batches, and lifting the parsed JSON back into project graph DTOs.
 * Returns nothing more than `ProjectGraphEnrichmentExtraction`; the
 * enrichment orchestrator decides whether to persist them.
 */

import {
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  isProjectGraphNode,
  type ContextNode,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import {
  projectGraphLlmFactBatchSize,
  scheduleProjectGraphLlmRequest,
  type ProjectGraphLlmRequestPolicy,
} from './llm-request-policy.js';
import { createProjectGraphEdgeId, createProjectGraphNodeId } from './node-id.js';
import { contentLanguageInstruction } from '../content-locale.js';
import {
  parseSummaryResponse,
  type ParsedRelationshipItem,
  type ParsedSummaryItem,
} from './enrichment-llm-response.js';

const LLM_FACT_CAP = 80;

// Per-fact bounds. A single extracted node can carry a very large `content` or
// a huge evidence list (a hot dependency referenced by thousands of files), and
// the LLM only needs a few citations — so trim aggressively. Without this the
// serialized batch blew past providers' request-body byte caps (e.g. DashScope
// rejects >6 MB with HTTP 400).
const MAX_FACT_CONTENT_CHARS = 2000;
const MAX_FACT_EVIDENCE_PATHS = 20;
// Keep each request well under the smallest provider body cap we target (6 MB).
const MAX_REQUEST_BODY_BYTES = 1_000_000;

export interface ProjectGraphEnrichmentExtraction {
  nodes: ProjectGraphNodeDto[];
  edges: ProjectGraphEdgeDto[];
}

export interface SummarizeProjectGraphWithLlmInput {
  client: OpenAIClient;
  model: string;
  project: string;
  extractedNodes: ContextNode[];
  requestPolicy?: ProjectGraphLlmRequestPolicy;
}

export const summarizeProjectGraphWithLlm = async (
  input: SummarizeProjectGraphWithLlmInput,
): Promise<ProjectGraphEnrichmentExtraction> => {
  const evidencePaths = collectEvidencePaths(input.extractedNodes);
  const nodeIds = new Set(input.extractedNodes.filter(isProjectGraphNode).map((node) => node.id));
  if (evidencePaths.size === 0) return { nodes: [], edges: [] };

  const facts = collectExtractedFacts(input.extractedNodes, LLM_FACT_CAP);
  const parsed = { summaries: [] as ParsedSummaryItem[], relationships: [] as ParsedRelationshipItem[] };
  for (const batch of batchFactsForRequest(facts, projectGraphLlmFactBatchSize(input.requestPolicy))) {
    const response = await scheduleProjectGraphLlmRequest(() => input.client.chat.completions.create({
      model: input.model,
      temperature: 0.1,
      max_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You summarize a project graph for coding agents.',
            contentLanguageInstruction(),
            'Infer responsibilities, subsystem summaries, risks, open questions, and relationships only from provided extracted facts.',
            'Return JSON: {"summaries":[{"label":"...","summary":"...","evidencePaths":["path"],"confidence":"inferred|ambiguous"}],"relationships":[{"sourceId":"provided node id","targetId":"provided node id","kind":"related_to|depends_on|calls|imports|configures|renders|binds_to|references_asset","evidencePaths":["path"],"confidence":"inferred|ambiguous"}]}.',
            'Every item must cite at least one provided evidence path.',
            'Relationships must only use node ids from the provided extracted facts.',
          ].join(' '),
        },
        {
          role: 'user',
          content: renderExtractedFacts(input.project, batch),
        },
      ],
    }), input.requestPolicy);

    const content = response.choices[0]?.message?.content;
    if (!content) continue;
    const batchParsed = parseSummaryResponse(content);
    parsed.summaries.push(...batchParsed.summaries);
    parsed.relationships.push(...batchParsed.relationships);
  }
  return {
    nodes: mergeProjectGraphNodes(parsed.summaries
      .map((item) => toInferredNode(input.project, item, evidencePaths))
      .filter((node): node is ProjectGraphNodeDto => node !== null),
    ),
    edges: mergeProjectGraphEdges(parsed.relationships
      .map((item) => toInferredEdge(item, evidencePaths, nodeIds))
      .filter((edge): edge is ProjectGraphEdgeDto => edge !== null),
    ),
  };
};

interface RenderedLlmFact {
  id: string;
  kind: unknown;
  title: string;
  content: string;
  evidence: string[];
}

const collectExtractedFacts = (nodes: ContextNode[], cap: number): RenderedLlmFact[] =>
  // Keep the LLM payload bounded; sort first so the cap drops the least salient facts.
  nodes
    .filter(isProjectGraphNode)
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] === ProjectGraphProvenance.EXTRACTED)
    .sort(compareExtractedFactSalience)
    .slice(0, cap)
    .map((node) => ({
      id: node.id,
      kind: node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind],
      title: node.title,
      content: truncate(node.content, MAX_FACT_CONTENT_CHARS),
      evidence: collectNodeEvidencePaths(node).slice(0, MAX_FACT_EVIDENCE_PATHS),
    }));

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const renderExtractedFacts = (project: string, facts: RenderedLlmFact[]): string =>
  JSON.stringify({ project, extractedFacts: facts });

/**
 * Split facts into request batches bounded by BOTH count (provider rate/quality)
 * and serialized byte size (provider body cap). Per-fact trimming in
 * `collectExtractedFacts` keeps any single fact small, so a fact always fits in
 * a batch; this just stops many mid-size facts from summing past the byte cap.
 */
const batchFactsForRequest = (facts: RenderedLlmFact[], maxCount: number): RenderedLlmFact[][] => {
  const batches: RenderedLlmFact[][] = [];
  let current: RenderedLlmFact[] = [];
  let currentBytes = 0;
  for (const fact of facts) {
    const factBytes = Buffer.byteLength(JSON.stringify(fact), 'utf8');
    if (current.length > 0 && (current.length >= maxCount || currentBytes + factBytes > MAX_REQUEST_BODY_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(fact);
    currentBytes += factBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

/**
 * 合并多 batch 产出的同 id 节点：
 * - evidence 取并集（按 path+extractorId 去重）；
 * - provenance 收敛到较弱者：若任一副本是 AMBIGUOUS，结果就是 AMBIGUOUS；
 * - metadata 合并（后者覆盖同名键）；其他字段以首次出现的为准。
 */
const mergeProjectGraphNodes = (nodes: ProjectGraphNodeDto[]): ProjectGraphNodeDto[] => {
  const merged = new Map<string, ProjectGraphNodeDto>();
  for (const node of nodes) {
    const existing = merged.get(node.id);
    if (!existing) {
      merged.set(node.id, { ...node, evidence: [...node.evidence] });
      continue;
    }
    existing.evidence = mergeEvidence(existing.evidence, node.evidence);
    existing.provenance = weakerProvenance(existing.provenance, node.provenance);
    existing.metadata = { ...existing.metadata, ...node.metadata };
  }
  return Array.from(merged.values());
};

const mergeProjectGraphEdges = (edges: ProjectGraphEdgeDto[]): ProjectGraphEdgeDto[] => {
  const merged = new Map<string, ProjectGraphEdgeDto>();
  for (const edge of edges) {
    const existing = merged.get(edge.id);
    if (!existing) {
      merged.set(edge.id, { ...edge, evidence: [...edge.evidence] });
      continue;
    }
    existing.evidence = mergeEvidence(existing.evidence, edge.evidence);
    existing.provenance = weakerProvenance(existing.provenance, edge.provenance);
    existing.metadata = { ...existing.metadata, ...edge.metadata };
  }
  return Array.from(merged.values());
};

const mergeEvidence = <T extends { path: string; extractorId: string }>(a: T[], b: T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of [...a, ...b]) {
    const key = `${item.path}\u0000${item.extractorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const weakerProvenance = (a: ProjectGraphProvenance, b: ProjectGraphProvenance): ProjectGraphProvenance =>
  a === ProjectGraphProvenance.AMBIGUOUS || b === ProjectGraphProvenance.AMBIGUOUS
    ? ProjectGraphProvenance.AMBIGUOUS
    : a;

const compareExtractedFactSalience = (a: ContextNode, b: ContextNode): number =>
  salienceScore(b) - salienceScore(a) || a.title.localeCompare(b.title);

const salienceScore = (node: ContextNode): number =>
  node.positiveFeedback * 20 + node.accessCount * 5 + node.qualityScore + collectNodeEvidencePaths(node).length * 2;

const toInferredNode = (
  project: string,
  item: ParsedSummaryItem,
  allowedEvidencePaths: Set<string>,
): ProjectGraphNodeDto | null => {
  const evidence = item.evidencePaths
    .filter((path) => allowedEvidencePaths.has(path))
    .map((path) => ({ path, extractorId: 'llm-enrichment' }));
  if (evidence.length === 0) return null;
  return {
    id: createProjectGraphNodeId({
      project,
      kind: ProjectGraphNodeKind.CONCEPT,
      key: item.label,
    }),
    kind: ProjectGraphNodeKind.CONCEPT,
    label: item.label,
    project,
    provenance: item.confidence === 'ambiguous'
      ? ProjectGraphProvenance.AMBIGUOUS
      : ProjectGraphProvenance.INFERRED,
    evidence,
    metadata: {
      summary: item.summary,
      llmEnrichment: true,
    },
  };
};

const toInferredEdge = (
  item: ParsedRelationshipItem,
  allowedEvidencePaths: Set<string>,
  allowedNodeIds: Set<string>,
): ProjectGraphEdgeDto | null => {
  if (!allowedNodeIds.has(item.sourceId) || !allowedNodeIds.has(item.targetId)) return null;
  const evidence = item.evidencePaths
    .filter((path) => allowedEvidencePaths.has(path))
    .map((path) => ({ path, extractorId: 'llm-enrichment' }));
  if (evidence.length === 0) return null;
  return {
    id: createProjectGraphEdgeId({ sourceId: item.sourceId, targetId: item.targetId, kind: item.kind }),
    sourceId: item.sourceId,
    targetId: item.targetId,
    kind: item.kind,
    provenance: item.confidence === 'ambiguous'
      ? ProjectGraphProvenance.AMBIGUOUS
      : ProjectGraphProvenance.INFERRED,
    evidence,
    metadata: { llmEnrichment: true },
  };
};

const collectEvidencePaths = (nodes: ContextNode[]): Set<string> =>
  new Set(nodes.flatMap(collectNodeEvidencePaths));

const collectNodeEvidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.evidence];
  return Array.isArray(evidence)
    ? evidence
      .map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
