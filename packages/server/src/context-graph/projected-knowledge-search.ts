import type { GraphKnowledgeSearchResult, GraphKnowledgeView } from '@mindstrate/protocol/models';
import {
  ContextRelationType,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from './context-graph-store.js';
import type { GraphKnowledgeProjector, GraphKnowledgeProjectionOptions } from './knowledge-projector.js';

export interface ProjectedKnowledgeSearchOptions extends GraphKnowledgeProjectionOptions {
  topK?: number;
  sessionId?: string;
  trackFeedback?: boolean;
}

export class ProjectedKnowledgeSearch {
  private readonly projector: GraphKnowledgeProjector;
  private readonly graphStore?: ContextGraphStore;

  constructor(projector: GraphKnowledgeProjector, graphStore?: ContextGraphStore) {
    this.projector = projector;
    this.graphStore = graphStore;
  }

  search(query: string, options: ProjectedKnowledgeSearchOptions = {}): GraphKnowledgeSearchResult[] {
    const topK = options.topK ?? 10;
    const candidates = this.projector.project({
      project: options.project,
      limit: Math.max(options.limit ?? 0, topK * 10, 50),
      includeStatuses: options.includeStatuses,
      // Default-on for the search path: `graph_knowledge_search` /
      // `memory_search` exist precisely to surface evidence-rich
      // project graph facts (file/module/dependency/asset nodes), so
      // the projector's "exclude project graph nodes" guard would make
      // the tools return nothing for the most common queries. The
      // assembly DAG, which calls into the same projector for the
      // task-curation slice, sets this explicitly to `false` to keep
      // its behavior unchanged.
      includeProjectGraphNodes: options.includeProjectGraphNodes ?? true,
    });

    const tokens = tokenizeQuery(query);
    return candidates
      .map((view) => this.scoreView(query, tokens, view))
      .filter((result) => result.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);
  }

  private scoreView(query: string, tokens: QueryToken[], view: GraphKnowledgeView): GraphKnowledgeSearchResult {
    const directScore = computeProjectionMatchScore(tokens, view);
    const related = this.findBestSupportingEvidence(query, tokens, view);
    if (related && related.score > directScore) {
      return {
        view,
        relevanceScore: Math.min(0.99, related.score * 0.75 + Math.min(view.priorityScore, 1) * 0.25),
        matchReason: `Graph projection | Projected ${view.substrateType} match supported by related ${related.node.substrateType}`,
      };
    }

    return {
      view,
      relevanceScore: directScore,
      matchReason: `Graph projection | Projected ${view.substrateType} match`,
    };
  }

  private findBestSupportingEvidence(
    query: string,
    tokens: QueryToken[],
    view: GraphKnowledgeView,
  ): { node: ContextNode; score: number } | null {
    if (!this.graphStore) return null;

    const supportEdges = this.graphStore.listIncomingEdges(view.id, ContextRelationType.SUPPORTS);
    let best: { node: ContextNode; score: number } | null = null;
    for (const edge of supportEdges) {
      const node = this.graphStore.getNodeById(edge.sourceId);
      if (!node) continue;
      const score = computeFieldedTextMatchScore(tokens, {
        title: node.title,
        body: node.content,
      });
      if (!best || score > best.score) {
        best = { node, score };
      }
    }
    return best;
  }
}

/**
 * Compute a projection match score for a single graph knowledge view.
 *
 * Two adjustments matter compared to the naive "matched tokens / total
 * tokens" baseline that real-world testing showed is too weak:
 *
 *  1. Field-weighted scoring. A title / sourceRef hit is dramatically
 *     more meaningful than a body hit (the title is the index column
 *     a human would search by). Without weights, a generic dependency
 *     node like `usePathname` with `path` somewhere in its body
 *     would tie a project-specific summary that mentions `path-aware
 *     seed selection` four times in title + steps.
 *  2. Token quality. Single-character tokens and short tokens
 *     (length < 3) are demoted because they over-trigger; `set`
 *     would substring-match every web-ui setter (`setResults`,
 *     `setLangFilter`, ...) and crowd out genuinely relevant nodes.
 *  3. Diversity bonus. Hitting two distinct tokens is worth more
 *     than hitting one token twice — coverage of the query intent
 *     matters more than echo count.
 *
 * Returns a value in [0, 0.99]. The final 0.99 cap leaves room for
 * the supporting-evidence path in `scoreView` to break ties without
 * exceeding the relevance scale the priority selector consumes.
 */
function computeProjectionMatchScore(tokens: QueryToken[], view: GraphKnowledgeView): number {
  if (tokens.length === 0) return 0;
  const lexicalScore = computeFieldedTextMatchScore(tokens, {
    title: view.title,
    sourceRef: view.sourceRef,
    tags: view.tags.join(' '),
    summary: view.summary,
    body: view.content,
    meta: `${view.domainType} ${view.substrateType}`,
  });
  if (lexicalScore === 0) return 0;
  return Math.min(0.99, lexicalScore * 0.6 + Math.min(view.priorityScore, 1) * 0.4);
}

interface QueryToken {
  text: string;
  /** Weight assigned by the tokenizer based on length / CJK status. */
  weight: number;
}

const FIELD_WEIGHTS = {
  title: 3.0,
  sourceRef: 2.0,
  tags: 2.0,
  summary: 1.2,
  body: 1.0,
  meta: 0.5,
} as const;

/**
 * Field-weighted lexical match. Each token contributes
 * `weight * field_weight * match_quality`, summed over fields, and
 * normalized by the maximum possible total (every token hitting every
 * field as an exact word). A diversity multiplier rewards covering
 * more distinct tokens vs. echoing the same one repeatedly.
 *
 * Match quality:
 *   - 1.0 for a word-boundary hit
 *   - 0.3 for a substring hit (still useful but not authoritative)
 *   - 0.0 otherwise
 *
 * Designed to keep noise like `path` in `usePathname` from
 * outranking a project-specific summary that contains `path-aware`,
 * `selectTaskNodes`, and `before-edit` simultaneously.
 */
function computeFieldedTextMatchScore(
  tokens: QueryToken[],
  fields: Partial<Record<keyof typeof FIELD_WEIGHTS, string | undefined>>,
): number {
  if (tokens.length === 0) return 0;
  let totalScore = 0;
  let maxScore = 0;
  const matchedTokenIds = new Set<string>();

  for (const token of tokens) {
    let bestFieldMatch = 0;
    for (const [field, fieldWeight] of Object.entries(FIELD_WEIGHTS) as Array<[
      keyof typeof FIELD_WEIGHTS,
      number,
    ]>) {
      maxScore += token.weight * fieldWeight;
      const haystack = fields[field];
      if (!haystack) continue;
      const quality = matchQuality(token.text, haystack.toLowerCase());
      if (quality > 0) {
        const contribution = token.weight * fieldWeight * quality;
        totalScore += contribution;
        if (contribution > bestFieldMatch) bestFieldMatch = contribution;
      }
    }
    if (bestFieldMatch > 0) matchedTokenIds.add(token.text);
  }

  if (totalScore === 0 || maxScore === 0) return 0;
  const base = totalScore / maxScore;
  // Diversity multiplier: 0.5 at one matched token, 1.0 at full
  // coverage of the query tokens.
  const coverage = matchedTokenIds.size / Math.max(tokens.length, 1);
  const diversity = 0.5 + 0.5 * coverage;
  return Math.min(0.99, base * diversity * 4);
  // The ×4 multiplier is the empirical scale factor: with the
  // weighted denominator above, even a strong title hit only reaches
  // ~0.20 raw, which the projector's downstream 0.6/0.4 blend would
  // then quench. Scaling the lexical score back into roughly the
  // same [0, 1) range the old `matched / total` produced keeps the
  // priority selector tuning unchanged.
}

const WORD_BOUNDARY = /[^a-z0-9\u4e00-\u9fff]/;

function matchQuality(token: string, haystack: string): number {
  const index = haystack.indexOf(token);
  if (index < 0) return 0;
  const before = index === 0 ? undefined : haystack[index - 1];
  const after = haystack[index + token.length];
  const leftBoundary = before === undefined || WORD_BOUNDARY.test(before);
  const rightBoundary = after === undefined || WORD_BOUNDARY.test(after);
  if (leftBoundary && rightBoundary) return 1.0;
  return 0.3;
}

const CJK_RANGE = /[\u4e00-\u9fff]/;

/**
 * Split the query into weighted tokens. Lowercase ASCII tokens are
 * weighted by length (3+ chars = 1.0, 2 chars = 0.4, 1 char = 0.1).
 * Chinese / CJK runs of 2+ characters are treated as a single token
 * with weight 1.0; isolated single CJK characters get 0.3 so a
 * stray 「的」 does not match every Chinese node.
 */
function tokenizeQuery(query: string): QueryToken[] {
  const seen = new Map<string, QueryToken>();
  const rawTokens = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
  for (const raw of rawTokens) {
    const isCjk = CJK_RANGE.test(raw);
    let weight: number;
    if (isCjk) {
      weight = raw.length >= 2 ? 1.0 : 0.3;
    } else if (raw.length >= 3) {
      weight = 1.0;
    } else if (raw.length === 2) {
      weight = 0.4;
    } else {
      weight = 0.1;
    }
    if (!seen.has(raw)) seen.set(raw, { text: raw, weight });
  }
  return Array.from(seen.values());
}
