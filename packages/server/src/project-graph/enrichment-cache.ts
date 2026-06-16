/**
 * LLM enrichment idempotence cache.
 *
 * Stores a SHA-256 of the extracted facts that drove the most recent
 * successful enrichment, attached to a deterministic ECS node so the next
 * run can short-circuit when the input set hasn't changed. The node lives
 * in the same project graph as the snapshots it summarizes, but is tagged
 * with `LLM_ENRICHMENT_CACHE_TAG` so the metabolism pruner can skip it
 * (see `isProtected` in `pruner.ts`).
 */

import { createHash } from 'node:crypto';
import {
  ContextDomainType,
  ContextNodeStatus,
  LLM_ENRICHMENT_CACHE_TAG,
  PROJECT_GRAPH_METADATA_KEYS,
  ProjectGraphProvenance,
  SubstrateType,
  isProjectGraphNode,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';

/**
 * Tag attached to the LLM enrichment cache node. Read by
 * `metabolism/pruner.ts` so stale-snapshot heuristics never archive
 * a cache record by accident, and by the knowledge projector so the cache
 * node never surfaces as a user-facing knowledge card. The canonical
 * definition lives in `@mindstrate/protocol/models`; re-exported here for the
 * existing import sites.
 */
export { LLM_ENRICHMENT_CACHE_TAG };

export const hashExtractedFacts = (nodes: ContextNode[]): string => {
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

export const previousEnrichmentInputHash = (
  store: ContextGraphStore,
  project: string,
): string | undefined => {
  const hash = store.getNodeById(cacheNodeId(project))?.metadata?.['inputHash'];
  return typeof hash === 'string' ? hash : undefined;
};

export const upsertEnrichmentCacheNode = (
  store: ContextGraphStore,
  project: string,
  inputHash: string,
): void => {
  const id = cacheNodeId(project);
  const update = {
    title: 'Project graph LLM enrichment cache',
    content: `inputHash: ${inputHash}`,
    tags: ['project-graph', LLM_ENRICHMENT_CACHE_TAG],
    project,
    status: ContextNodeStatus.ACTIVE,
    // Mark as a project-graph node so it's excluded from the user-facing
    // knowledge projection (same gate that hides file/dir/symbol nodes).
    metadata: { inputHash, [PROJECT_GRAPH_METADATA_KEYS.projectGraph]: true },
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

const cacheNodeId = (project: string): string => `pg:${project}:llm-enrichment-cache`;
