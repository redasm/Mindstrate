import {
  ProjectGraphProvenance,
  type ProjectGraphNodeDto,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { writeProjectGraphExtraction } from './graph-writer.js';

export interface ProjectGraphEnrichmentInput {
  project: string;
  llmConfigured: boolean;
  summarize?: () => Promise<ProjectGraphNodeDto[]>;
}

export type ProjectGraphEnrichmentResult =
  | { status: 'skipped'; reason: 'llm_not_configured' | 'summarizer_not_configured'; nodesCreated: 0 }
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
