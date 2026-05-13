/**
 * Feedback co-occurrence compressor.
 *
 * Borrows ACE's "Curator" idea: take low-level facts that the system has
 * observed working together (in our case, project graph nodes that the
 * AI marked as `adopted` / `partial` in the same retrieval session via
 * `memory_feedback_auto`) and crystallize them into a higher-substrate
 * `PATTERN + ARCHITECTURE` node that the regular
 * `ContextPrioritySelector` can pick on its own next time around.
 *
 * Why this matters for relationship-graph utilization: the priority
 * selector only ever looks at `RULE / PATTERN / SUMMARY` substrate. The
 * raw project graph nodes are `SNAPSHOT + ARCHITECTURE`, so they are
 * invisible to that selector. By compressing co-used graph nodes into a
 * `PATTERN`, we give the selector a handle to the relationship network
 * without forcing the assembly path to graph-traverse on every call.
 *
 * Closes the loop set up by
 *   `MindstrateContextAssemblyApi.trackAssemblyRetrievals` (mints
 *    feedback_events rows when nodes are surfaced)
 *   ↓
 *   `memory_feedback_auto` (AI tells us which were used)
 *   ↓
 *   THIS COMPRESSOR (turns repeated co-use into PATTERN nodes)
 *   ↓
 *   `ContextPrioritySelector` (picks those PATTERNs next time)
 *
 * Idempotent: same set of source ids ⇒ same deterministic id ⇒ update
 * instead of insert. SUPPORTS edges go PATTERN -> source so
 * `ProjectedKnowledgeSearch.findBestSupportingEvidence` can walk back to
 * the underlying project graph nodes.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  PROJECT_GRAPH_METADATA_KEYS,
  SubstrateType,
  type ContextEdge,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';

export interface FeedbackCooccurrenceCompressionOptions {
  /** Restrict to one project. Defaults to all projects. */
  project?: string;
  /** Only consider node pairs co-used at least this many times. Defaults to 3. */
  minCoOccurrence?: number;
  /** Hard cap on how many PATTERN nodes to materialize per run. Defaults to 20. */
  limit?: number;
  /**
   * Only count feedback events whose `signal` is in this set. Defaults
   * to `['adopted', 'partial']` because `ignored` / `rejected` clearly
   * carry no positive co-occurrence signal.
   */
  positiveSignals?: ReadonlyArray<'adopted' | 'partial'>;
}

export interface FeedbackCooccurrenceCluster {
  /** Deterministic id of the PATTERN node materialized for this cluster. */
  patternNodeId: string;
  /** Project graph node ids the AI used together. */
  sourceNodeIds: string[];
  /** How many sessions exhibited this co-use. */
  coOccurrence: number;
}

export interface FeedbackCooccurrenceCompressionResult {
  /** Number of distinct sessions inspected for co-use. */
  scannedSessions: number;
  /** PATTERN nodes created in this run. */
  patternNodesCreated: number;
  /** PATTERN nodes that already existed and were refreshed. */
  patternNodesUpdated: number;
  /** Per-cluster summary. */
  clusters: FeedbackCooccurrenceCluster[];
}

const DEFAULT_MIN_COOCCURRENCE = 3;
const DEFAULT_LIMIT = 20;
const DEFAULT_POSITIVE_SIGNALS = ['adopted', 'partial'] as const;
const PATTERN_ID_PREFIX = 'pattern:co-occurrence:';
const PATTERN_TAG = 'feedback-cooccurrence';

export class FeedbackCooccurrenceCompressor {
  constructor(
    private readonly graphStore: ContextGraphStore,
    private readonly db: Database.Database,
  ) {}

  compress(
    options: FeedbackCooccurrenceCompressionOptions = {},
  ): FeedbackCooccurrenceCompressionResult {
    const minCoOccurrence = Math.max(options.minCoOccurrence ?? DEFAULT_MIN_COOCCURRENCE, 2);
    const limit = Math.max(options.limit ?? DEFAULT_LIMIT, 1);
    const signals = options.positiveSignals ?? DEFAULT_POSITIVE_SIGNALS;

    const sessionGroups = collectSessionNodeGroups(this.db, signals);
    const pairCounts = countPairs(sessionGroups);
    const eligible = filterEligiblePairs(pairCounts, minCoOccurrence)
      .slice(0, limit);

    const result: FeedbackCooccurrenceCompressionResult = {
      scannedSessions: sessionGroups.size,
      patternNodesCreated: 0,
      patternNodesUpdated: 0,
      clusters: [],
    };

    for (const pair of eligible) {
      const sourceNodes = pair.nodeIds
        .map((id) => this.graphStore.getNodeById(id))
        .filter((node): node is ContextNode => !!node);
      if (sourceNodes.length < 2) continue;
      if (!sourceNodes.every(isProjectGraphAssemblableNode)) continue;
      if (options.project
        && !sourceNodes.every((node) => node.project === options.project)) continue;

      const supportingEdges = collectInterconnectingEdges(this.graphStore, sourceNodes);
      const upsert = this.upsertPatternNode(sourceNodes, supportingEdges, pair.count);
      if (upsert.created) result.patternNodesCreated++;
      else result.patternNodesUpdated++;
      this.upsertSupportEdges(upsert.id, sourceNodes);
      result.clusters.push({
        patternNodeId: upsert.id,
        sourceNodeIds: sourceNodes.map((node) => node.id),
        coOccurrence: pair.count,
      });
    }

    return result;
  }

  private upsertPatternNode(
    sourceNodes: ContextNode[],
    supportingEdges: ContextEdge[],
    coOccurrence: number,
  ): { id: string; created: boolean } {
    const id = patternNodeIdForSources(sourceNodes);
    const title = renderPatternTitle(sourceNodes);
    const content = renderPatternContent(sourceNodes, supportingEdges, coOccurrence);
    const project = sourceNodes[0]!.project;
    const metadata: Record<string, unknown> = {
      compressedFromNodeIds: sourceNodes.map((node) => node.id),
      coOccurrence,
      compressedAt: new Date().toISOString(),
    };

    const existing = this.graphStore.getNodeById(id);
    if (existing) {
      this.graphStore.updateNode(id, {
        title,
        content,
        metadata,
        status: ContextNodeStatus.ACTIVE,
      });
      return { id, created: false };
    }

    this.graphStore.createNode({
      id,
      substrateType: SubstrateType.PATTERN,
      domainType: ContextDomainType.ARCHITECTURE,
      title,
      content,
      tags: ['pattern', PATTERN_TAG],
      project,
      compressionLevel: 0.05,
      confidence: 0.85,
      qualityScore: 80,
      status: ContextNodeStatus.ACTIVE,
      metadata,
    });
    return { id, created: true };
  }

  private upsertSupportEdges(patternId: string, sourceNodes: ContextNode[]): void {
    for (const node of sourceNodes) {
      // PATTERN -> source so `ProjectedKnowledgeSearch.findBestSupportingEvidence`
      // (which queries `listIncomingEdges(view.id, SUPPORTS)`) can walk
      // back from the surfaced source to the synthesized PATTERN.
      // SUPPORTS edge id is deterministic so this is idempotent across
      // recompresses.
      const edgeId = `${patternId}->${node.id}:supports`;
      try {
        this.graphStore.createEdge({
          id: edgeId,
          sourceId: patternId,
          targetId: node.id,
          relationType: ContextRelationType.SUPPORTS,
          strength: 0.85,
          evidence: { reason: 'feedback-cooccurrence-compression' },
        });
      } catch {
        // Duplicate id from a prior run is the expected idempotent path.
      }
    }
  }
}

const collectSessionNodeGroups = (
  db: Database.Database,
  signals: ReadonlyArray<'adopted' | 'partial'>,
): Map<string, Set<string>> => {
  const placeholders = signals.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT session_id, node_id
    FROM feedback_events
    WHERE signal IN (${placeholders})
      AND session_id IS NOT NULL
  `).all(...signals) as Array<{ session_id: string; node_id: string }>;

  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = groups.get(row.session_id) ?? new Set<string>();
    set.add(row.node_id);
    groups.set(row.session_id, set);
  }
  return groups;
};

interface PairCount {
  nodeIds: [string, string];
  count: number;
}

const countPairs = (sessionGroups: Map<string, Set<string>>): PairCount[] => {
  const counts = new Map<string, number>();
  const idsByKey = new Map<string, [string, string]>();
  for (const nodes of sessionGroups.values()) {
    const sorted = [...nodes].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}|${sorted[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!idsByKey.has(key)) idsByKey.set(key, [sorted[i]!, sorted[j]!]);
      }
    }
  }
  return [...counts.entries()].map(([key, count]) => ({
    nodeIds: idsByKey.get(key)!,
    count,
  }));
};

const filterEligiblePairs = (pairs: PairCount[], minCoOccurrence: number): PairCount[] =>
  pairs
    .filter((pair) => pair.count >= minCoOccurrence)
    .sort((left, right) => right.count - left.count);

const isProjectGraphAssemblableNode = (node: ContextNode): boolean =>
  node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.projectGraph] === true;

const collectInterconnectingEdges = (
  graphStore: ContextGraphStore,
  nodes: ContextNode[],
): ContextEdge[] => {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: ContextEdge[] = [];
  for (const node of nodes) {
    for (const edge of graphStore.listEdges({ sourceId: node.id, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT })) {
      if (!ids.has(edge.targetId) || seen.has(edge.id)) continue;
      seen.add(edge.id);
      edges.push(edge);
    }
  }
  return edges;
};

const patternNodeIdForSources = (sourceNodes: ContextNode[]): string => {
  const sortedIds = sourceNodes.map((node) => node.id).sort().join('|');
  const hash = createHash('sha1').update(sortedIds).digest('hex').slice(0, 16);
  return `${PATTERN_ID_PREFIX}${hash}`;
};

const renderPatternTitle = (sourceNodes: ContextNode[]): string => {
  const labels = sourceNodes.map((node) => node.title).slice(0, 3);
  return `Co-used: ${labels.join(' + ')}${sourceNodes.length > 3 ? ` (+${sourceNodes.length - 3} more)` : ''}`;
};

const renderPatternContent = (
  sourceNodes: ContextNode[],
  supportingEdges: ContextEdge[],
  coOccurrence: number,
): string => {
  const lines: string[] = [];
  lines.push(`Observed ${coOccurrence} co-uses of these project graph nodes:`);
  for (const node of sourceNodes) {
    const kind = String(node.metadata?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? 'unknown');
    lines.push(`- [${kind}] ${node.title} (id: ${node.id})`);
  }
  if (supportingEdges.length > 0) {
    lines.push('');
    lines.push('Direct relationships between these nodes:');
    for (const edge of supportingEdges) {
      const kind = String(edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] ?? edge.relationType);
      lines.push(`- ${edge.sourceId} -[${kind}]-> ${edge.targetId}`);
    }
  }
  return lines.join('\n');
};
