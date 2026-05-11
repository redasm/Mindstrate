/**
 * LLM response parsing for the project graph enrichment summarizer.
 *
 * Splits raw `ChatCompletion` JSON into typed `ParsedSummaryItem` /
 * `ParsedRelationshipItem` lists with the same defensive normalization
 * the runtime relied on before. Kept separate from the LLM call site
 * (`enrichment-llm-summarizer.ts`) so the parsing logic is unit-testable
 * without spinning up an OpenAI client mock.
 */

import {
  ProjectGraphEdgeKind,
} from '@mindstrate/protocol/models';

export interface ParsedSummaryItem {
  label: string;
  summary: string;
  evidencePaths: string[];
  confidence: 'inferred' | 'ambiguous';
}

export interface ParsedRelationshipItem {
  sourceId: string;
  targetId: string;
  kind: ProjectGraphEdgeKind;
  evidencePaths: string[];
  confidence: 'inferred' | 'ambiguous';
}

export interface ParsedEnrichmentResponse {
  summaries: ParsedSummaryItem[];
  relationships: ParsedRelationshipItem[];
}

export const parseSummaryResponse = (content: string): ParsedEnrichmentResponse => {
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
