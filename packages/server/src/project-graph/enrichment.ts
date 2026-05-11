import { createHash } from 'node:crypto';
import {
  ContextDomainType,
  ContextNodeStatus,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphEdgeKind,
  ProjectGraphNodeKind,
  ProjectGraphProvenance,
  SubstrateType,
  isProjectGraphNode,
  type ContextNode,
  type ProjectGraphEdgeDto,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { OpenAIClient } from '../openai-client.js';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { writeProjectGraphExtraction } from './graph-writer.js';
import {
  projectGraphLlmFactBatchSize,
  scheduleProjectGraphLlmRequest,
  type ProjectGraphLlmRequestPolicy,
} from './llm-request-policy.js';
import { createProjectGraphEdgeId, createProjectGraphNodeId } from './node-id.js';
import { projectGraphLanguageInstruction } from './project-graph-locale.js';

const LLM_FACT_CAP = 80;

export interface ProjectGraphEnrichmentInput {
  project: string;
  llmConfigured: boolean;
  extractedNodes?: ContextNode[];
  summarize?: () => Promise<ProjectGraphNodeDto[] | ProjectGraphEnrichmentExtraction>;
}

export interface ProjectGraphEnrichmentExtraction {
  nodes: ProjectGraphNodeDto[];
  edges: ProjectGraphEdgeDto[];
}

export type ProjectGraphEnrichmentResult =
  | { status: 'skipped'; reason: 'llm_not_configured' | 'summarizer_not_configured'; nodesCreated: 0 }
  | { status: 'noop'; reason?: 'unchanged_input'; nodesCreated: 0; nodesUpdated: 0 }
  | { status: 'enriched'; nodesCreated: number; nodesUpdated: number };

export interface SummarizeProjectGraphWithLlmInput {
  client: OpenAIClient;
  model: string;
  project: string;
  extractedNodes: ContextNode[];
  requestPolicy?: ProjectGraphLlmRequestPolicy;
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

  const inputHash = input.extractedNodes ? hashExtractedFacts(input.extractedNodes) : undefined;
  if (inputHash && previousInputHash(store, input.project) === inputHash) {
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

export const summarizeProjectGraphWithLlm = async (
  input: SummarizeProjectGraphWithLlmInput,
): Promise<ProjectGraphEnrichmentExtraction> => {
  const evidencePaths = collectEvidencePaths(input.extractedNodes);
  const nodeIds = new Set(input.extractedNodes.filter(isProjectGraphNode).map((node) => node.id));
  if (evidencePaths.size === 0) return { nodes: [], edges: [] };

  const facts = collectExtractedFacts(input.extractedNodes, LLM_FACT_CAP);
  const parsed = { summaries: [] as ParsedSummaryItem[], relationships: [] as ParsedRelationshipItem[] };
  for (const batch of chunk(facts, projectGraphLlmFactBatchSize(input.requestPolicy))) {
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
            projectGraphLanguageInstruction(),
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

interface ParsedSummaryItem {
  label: string;
  summary: string;
  evidencePaths: string[];
  confidence: 'inferred' | 'ambiguous';
}

interface ParsedRelationshipItem {
  sourceId: string;
  targetId: string;
  kind: ProjectGraphEdgeKind;
  evidencePaths: string[];
  confidence: 'inferred' | 'ambiguous';
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
      content: node.content,
      evidence: collectNodeEvidencePaths(node),
    }));

const renderExtractedFacts = (project: string, facts: RenderedLlmFact[]): string => {
  return JSON.stringify({ project, extractedFacts: facts });
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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

const parseSummaryResponse = (content: string): { summaries: ParsedSummaryItem[]; relationships: ParsedRelationshipItem[] } => {
  try {
    const parsed = JSON.parse(content) as { summaries?: unknown; relationships?: unknown };
    const summaries = Array.isArray(parsed.summaries)
      ? parsed.summaries
      .map(normalizeSummaryItem)
        .filter((item): item is ParsedSummaryItem => item !== null)
      : [];
    const relationships = Array.isArray(parsed.relationships)
      ? parsed.relationships
        .map(normalizeRelationshipItem)
        .filter((item): item is ParsedRelationshipItem => item !== null)
      : [];
    return { summaries, relationships };
  } catch {
    return { summaries: [], relationships: [] };
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

const normalizeRelationshipItem = (value: unknown): ParsedRelationshipItem | null => {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const sourceId = typeof item['sourceId'] === 'string' ? item['sourceId'].trim() : '';
  const targetId = typeof item['targetId'] === 'string' ? item['targetId'].trim() : '';
  const evidencePaths = Array.isArray(item['evidencePaths'])
    ? item['evidencePaths'].filter((path): path is string => typeof path === 'string' && path.length > 0)
    : [];
  const kind = normalizeEdgeKind(item['kind']);
  const confidence = item['confidence'] === 'ambiguous' ? 'ambiguous' : 'inferred';
  if (!sourceId || !targetId || sourceId === targetId || evidencePaths.length === 0) return null;
  return { sourceId, targetId, kind, evidencePaths, confidence };
};

const normalizeEdgeKind = (value: unknown): ProjectGraphEdgeKind => {
  if (typeof value !== 'string') return ProjectGraphEdgeKind.RELATED_TO;
  return Object.values(ProjectGraphEdgeKind).includes(value as ProjectGraphEdgeKind)
    ? value as ProjectGraphEdgeKind
    : ProjectGraphEdgeKind.RELATED_TO;
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

const hashExtractedFacts = (nodes: ContextNode[]): string => {
  const facts = nodes
    .filter(isProjectGraphNode)
    .filter((node) => node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.provenance] === ProjectGraphProvenance.EXTRACTED)
    .map((node) => ({
      id: node.id,
      title: node.title,
      content: node.content,
      sourceRef: node.sourceRef,
      metadata: node.metadata,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
};

const cacheNodeId = (project: string): string => `pg:${project}:llm-enrichment-cache`;

const previousInputHash = (store: ContextGraphStore, project: string): string | undefined => {
  const hash = store.getNodeById(cacheNodeId(project))?.metadata?.['inputHash'];
  return typeof hash === 'string' ? hash : undefined;
};

const upsertEnrichmentCacheNode = (store: ContextGraphStore, project: string, inputHash: string): void => {
  const id = cacheNodeId(project);
  const update = {
    title: 'Project graph LLM enrichment cache',
    content: `inputHash: ${inputHash}`,
    tags: ['project-graph', 'llm-enrichment-cache'],
    project,
    status: ContextNodeStatus.ACTIVE,
    metadata: { inputHash },
  };
  if (store.getNodeById(id)) {
    store.updateNode(id, update);
    return;
  }
  store.createNode({
    id,
    substrateType: SubstrateType.SNAPSHOT,
    domainType: ContextDomainType.ARCHITECTURE,
    compressionLevel: 1,
    confidence: 1,
    qualityScore: 80,
    ...update,
  });
};
