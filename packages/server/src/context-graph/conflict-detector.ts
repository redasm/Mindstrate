import { cosineSimilarity } from '../processing/vector-distance.js';
import type { ProviderFactory } from '../processing/provider-factory.js';
import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextNodeStatus,
  ContextRelationType,
  SubstrateType,
  type ConflictRecord,
  type ContextNode,
} from '@mindstrate/protocol/models';

const NEGATION_MARKERS = [
  'avoid',
  'never',
  'must not',
  'do not',
  'obsolete',
  'reject',
  'forbidden',
];

const AFFIRMATION_MARKERS = [
  'use',
  'should',
  'must',
  'recommended',
  'allow',
  'supported',
];

/**
 * Conflict detection only makes sense for normative, prescriptive substrate —
 * a RULE/HEURISTIC/AXIOM can genuinely contradict another. SNAPSHOT / SUMMARY /
 * EPISODE / PATTERN / SKILL are long descriptive documents; running a
 * keyword-based "contradiction" check over them produces false positives,
 * because two near-identical documents both contain the same affirmation and
 * negation words (e.g. a project snapshot saying both "use the repository
 * layer" and "do not edit manually"). Restricting the scan to normative
 * substrate is the primary guard against that class of false positive.
 */
const NORMATIVE_SUBSTRATES: readonly SubstrateType[] = [
  SubstrateType.RULE,
  SubstrateType.HEURISTIC,
  SubstrateType.AXIOM,
];

export interface ConflictDetectionOptions {
  project?: string;
  substrateType?: SubstrateType;
  similarityThreshold?: number;
  /**
   * Upper similarity bound: pairs at or above this are treated as
   * near-duplicates (e.g. an assimilated copy of the same snapshot), not
   * contradictions, and are skipped. Defaults to 0.97.
   */
  duplicateThreshold?: number;
  limit?: number;
}

export interface ConflictDetectionResult {
  scannedNodes: number;
  conflictsDetected: number;
  records: ConflictRecord[];
}

export class ConflictDetector {
  private readonly graphStore: ContextGraphStore;
  private readonly providerFactory: ProviderFactory;

  constructor(graphStore: ContextGraphStore, providerFactory: ProviderFactory) {
    this.graphStore = graphStore;
    this.providerFactory = providerFactory;
  }

  async detectConflicts(options: ConflictDetectionOptions = {}): Promise<ConflictDetectionResult> {
    const similarityThreshold = options.similarityThreshold ?? 0.84;
    const duplicateThreshold = options.duplicateThreshold ?? 0.97;
    const limit = options.limit ?? 200;
    const embedder = this.providerFactory.forProject(options.project ?? '').embedder;

    // Only normative substrate can meaningfully contradict; descriptive
    // documents (snapshots/summaries/episodes/patterns/skills) are excluded to
    // avoid keyword-driven false positives. An explicit substrateType is still
    // honoured, but only if it is itself normative.
    const substrateTypes = options.substrateType
      ? (NORMATIVE_SUBSTRATES.includes(options.substrateType) ? [options.substrateType] : [])
      : NORMATIVE_SUBSTRATES;

    const nodes = substrateTypes.flatMap((substrateType) =>
      this.graphStore.listNodes({
        project: options.project,
        substrateType,
        limit,
      }),
    ).filter((node) => node.status !== ContextNodeStatus.ARCHIVED);

    const embeddings = new Map<string, number[]>();
    for (const node of nodes) {
      embeddings.set(node.id, await embedder.embed(node.content));
    }

    const records: ConflictRecord[] = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.substrateType !== b.substrateType) continue;

        const embeddingA = embeddings.get(a.id);
        const embeddingB = embeddings.get(b.id);
        if (!embeddingA || !embeddingB) continue;

        const similarity = cosineSimilarity(embeddingA, embeddingB);
        if (similarity < similarityThreshold) continue;
        // Near-identical content is a duplicate (e.g. an assimilated copy),
        // not a contradiction — skip rather than flag a false conflict.
        if (similarity >= duplicateThreshold) continue;
        if (!looksContradictory(a, b)) continue;
        if (this.hasRecordedConflict(a.id, b.id)) continue;

        this.graphStore.createEdge({
          sourceId: a.id,
          targetId: b.id,
          relationType: ContextRelationType.CONTRADICTS,
          strength: similarity,
          evidence: { similarity },
        });
        this.graphStore.createEdge({
          sourceId: b.id,
          targetId: a.id,
          relationType: ContextRelationType.CONTRADICTS,
          strength: similarity,
          evidence: { similarity },
        });

        this.graphStore.updateNode(a.id, { status: ContextNodeStatus.CONFLICTED });
        this.graphStore.updateNode(b.id, { status: ContextNodeStatus.CONFLICTED });

        records.push(this.graphStore.createConflictRecord({
          project: a.project ?? b.project,
          nodeIds: [a.id, b.id],
          reason: `High-similarity contradictory nodes detected (${similarity.toFixed(2)})`,
        }));
      }
    }

    return {
      scannedNodes: nodes.length,
      conflictsDetected: records.length,
      records,
    };
  }

  private hasRecordedConflict(aId: string, bId: string): boolean {
    return this.graphStore.listConflictRecords({ limit: 500 }).some((record) => {
      const ids = new Set(record.nodeIds);
      return ids.has(aId) && ids.has(bId);
    });
  }
}

function looksContradictory(a: ContextNode, b: ContextNode): boolean {
  const aContent = a.content.toLowerCase();
  const bContent = b.content.toLowerCase();

  const aHasNegation = NEGATION_MARKERS.some((marker) => aContent.includes(marker));
  const bHasNegation = NEGATION_MARKERS.some((marker) => bContent.includes(marker));
  const aHasAffirmation = AFFIRMATION_MARKERS.some((marker) => aContent.includes(marker));
  const bHasAffirmation = AFFIRMATION_MARKERS.some((marker) => bContent.includes(marker));

  return (aHasNegation && bHasAffirmation) || (bHasNegation && aHasAffirmation);
}
