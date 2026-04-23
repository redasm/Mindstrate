import { cosineSimilarity } from '../math.js';
import { Embedder } from '../processing/embedder.js';
import type { ContextGraphStore } from './context-graph-store.js';
import {
  ContextNodeStatus,
  ContextRelationType,
  type ConflictRecord,
  type ContextNode,
  type SubstrateType,
} from '@mindstrate/protocol/models';

const NEGATION_MARKERS = [
  'avoid',
  'never',
  'must not',
  'do not',
  'deprecated',
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

export interface ConflictDetectionOptions {
  project?: string;
  substrateType?: SubstrateType;
  similarityThreshold?: number;
  limit?: number;
}

export interface ConflictDetectionResult {
  scannedNodes: number;
  conflictsDetected: number;
  records: ConflictRecord[];
}

export class ConflictDetector {
  private readonly graphStore: ContextGraphStore;
  private readonly embedder: Embedder;

  constructor(graphStore: ContextGraphStore, embedder: Embedder) {
    this.graphStore = graphStore;
    this.embedder = embedder;
  }

  async detectConflicts(options: ConflictDetectionOptions = {}): Promise<ConflictDetectionResult> {
    const similarityThreshold = options.similarityThreshold ?? 0.84;
    const limit = options.limit ?? 200;

    const nodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: options.substrateType,
      limit,
    }).filter((node) => node.status !== ContextNodeStatus.DEPRECATED);

    const embeddings = new Map<string, number[]>();
    for (const node of nodes) {
      embeddings.set(node.id, await this.embedder.embed(node.content));
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
