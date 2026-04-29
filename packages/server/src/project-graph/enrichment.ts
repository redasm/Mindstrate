import {
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  type ContextNode,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { writeProjectGraphExtraction } from './graph-writer.js';
import { createProjectGraphNodeId } from './node-id.js';

export interface ProjectGraphEnrichmentInput {
  project: string;
  llmConfigured: boolean;
  summarize?: () => Promise<ProjectGraphNodeDto[]>;
}

export type ProjectGraphEnrichmentResult =
  | { status: 'skipped'; reason: 'llm_not_configured' | 'summarizer_not_configured'; nodesCreated: 0 }
  | { status: 'enriched'; nodesCreated: number; nodesUpdated: number };

export interface SummarizeProjectGraphWithLlmInput {
  client: OpenAIClient;
  model: string;
  project: string;
  extractedNodes: ContextNode[];
}

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

  const nodes = (await input.summarize()).filter(isAcceptableInference);
  const writeResult = writeProjectGraphExtraction(store, {
    project: input.project,
    nodes,
    edges: [],
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

export const summarizeProjectGraphWithLlm = async (
  input: SummarizeProjectGraphWithLlmInput,
): Promise<ProjectGraphNodeDto[]> => {
  const evidencePaths = collectEvidencePaths(input.extractedNodes);
  if (evidencePaths.size === 0) return [];

  const response = await input.client.chat.completions.create({
    model: input.model,
    temperature: 0.1,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You summarize a project graph for coding agents.',
          'Only infer responsibilities, subsystem summaries, risks, or open questions from provided extracted facts.',
          'Return JSON: {"summaries":[{"label":"...","summary":"...","evidencePaths":["path"],"confidence":"inferred|ambiguous"}]}.',
          'Every item must cite at least one provided evidence path.',
        ].join(' '),
      },
      {
        role: 'user',
        content: renderExtractedFacts(input.project, input.extractedNodes),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];
  const parsed = parseSummaryResponse(content);
  return parsed
    .map((item) => toInferredNode(input.project, item, evidencePaths))
    .filter((node): node is ProjectGraphNodeDto => node !== null);
};

interface ParsedSummaryItem {
  label: string;
  summary: string;
  evidencePaths: string[];
  confidence: 'inferred' | 'ambiguous';
}

const renderExtractedFacts = (project: string, nodes: ContextNode[]): string => {
  const facts = nodes
    .filter((node) => node.metadata?.['projectGraph'] === true)
    .filter((node) => node.metadata?.['provenance'] === ProjectGraphProvenance.EXTRACTED)
    .slice(0, 80)
    .map((node) => ({
      id: node.id,
      kind: node.metadata?.['kind'],
      title: node.title,
      content: node.content,
      evidence: collectNodeEvidencePaths(node),
    }));
  return JSON.stringify({ project, extractedFacts: facts });
};

const parseSummaryResponse = (content: string): ParsedSummaryItem[] => {
  try {
    const parsed = JSON.parse(content) as { summaries?: unknown };
    if (!Array.isArray(parsed.summaries)) return [];
    return parsed.summaries
      .map(normalizeSummaryItem)
      .filter((item): item is ParsedSummaryItem => item !== null);
  } catch {
    return [];
  }
};

const normalizeSummaryItem = (value: unknown): ParsedSummaryItem | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const label = typeof item['label'] === 'string' ? item['label'].trim() : '';
  const summary = typeof item['summary'] === 'string' ? item['summary'].trim() : '';
  const evidencePaths = Array.isArray(item['evidencePaths'])
    ? item['evidencePaths'].filter((path): path is string => typeof path === 'string' && path.length > 0)
    : [];
  const confidence = item['confidence'] === 'ambiguous' ? 'ambiguous' : 'inferred';
  if (!label || !summary || evidencePaths.length === 0) return null;
  return { label, summary, evidencePaths, confidence };
};

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

const collectEvidencePaths = (nodes: ContextNode[]): Set<string> =>
  new Set(nodes.flatMap(collectNodeEvidencePaths));

const collectNodeEvidencePaths = (node: ContextNode): string[] => {
  const evidence = node.metadata?.['evidence'];
  return Array.isArray(evidence)
    ? evidence
      .map((entry) => typeof entry === 'object' && entry && 'path' in entry ? String(entry.path) : '')
      .filter(Boolean)
    : [];
};
