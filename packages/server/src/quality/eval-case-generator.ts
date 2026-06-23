/**
 * Mindstrate - Eval dataset generator
 *
 * The retrieval evaluator (`RetrievalEvaluator`) only scores a *manually
 * authored* dataset of (query → expected knowledge ids) cases. Teams almost
 * never sit down to hand-write that dataset, so `eval_cases` stays empty and no
 * retrieval quality is ever measured.
 *
 * This generator bootstraps a dataset automatically from the knowledge the
 * graph already holds: for each high-value, projectable knowledge node it
 * derives a natural-language query (the node's title) and records the node's own
 * id as the expected hit — a "self-retrieval" probe. If searching that query
 * does NOT surface the node, retrieval quality for that knowledge is poor, which
 * is exactly what the evaluation is meant to catch.
 *
 * It is deterministic and idempotent: cases are keyed by the expected node id,
 * so re-running only adds cases for newly-covered knowledge.
 */

import type { GraphKnowledgeView } from '@mindstrate/protocol';
import type { EvalCase, EvalCaseKind } from '@mindstrate/protocol/models';

export interface EvalCaseGeneratorDeps {
  /** Projects the current knowledge graph into retrievable views. */
  projectKnowledge: (options: { project?: string; limit?: number }) => GraphKnowledgeView[];
  /** Existing cases, used to avoid duplicating coverage. */
  listCases: (options?: { kind?: EvalCaseKind }) => EvalCase[];
  /** Persists a new case. */
  addCase: (
    query: string,
    expectedIds: string[],
    options?: { language?: string; framework?: string; kind?: EvalCaseKind },
  ) => EvalCase;
}

export interface GenerateEvalCasesOptions {
  project?: string;
  /** Max number of new cases to create in this pass. */
  limit?: number;
  /** Which dataset partition to write into. Defaults to 'validation'. */
  kind?: EvalCaseKind;
  /**
   * How many of the generated cases to route into the 'holdout' partition
   * instead of `kind` (every Nth case). 0 disables the split. The holdout set
   * is what the skill-evolution gate scores against, so a mixed dataset gives
   * both a training-style validation set and an unbiased holdout set.
   */
  holdoutEveryNth?: number;
}

export interface GenerateEvalCasesResult {
  created: number;
  skippedExisting: number;
  consideredNodes: number;
}

const DEFAULT_LIMIT = 50;
const MIN_TITLE_LENGTH = 5;

export const generateEvalCasesFromKnowledge = (
  deps: EvalCaseGeneratorDeps,
  options: GenerateEvalCasesOptions = {},
): GenerateEvalCasesResult => {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const primaryKind: EvalCaseKind = options.kind ?? 'validation';
  const holdoutEveryNth = options.holdoutEveryNth ?? 0;

  // Pull a generous candidate set; the projector already sorts by priority so
  // the highest-value knowledge is covered first.
  const views = deps.projectKnowledge({ project: options.project, limit: Math.max(limit * 4, 100) });

  // Cover each node at most once across the whole dataset (both partitions).
  const covered = new Set<string>();
  for (const existing of deps.listCases()) {
    for (const id of existing.expectedIds) covered.add(id);
  }

  let created = 0;
  let skippedExisting = 0;
  let consideredNodes = 0;
  let generatedIndex = 0;

  for (const view of views) {
    if (created >= limit) break;
    const query = deriveQuery(view);
    if (!query) continue;
    consideredNodes += 1;

    if (covered.has(view.id)) {
      skippedExisting += 1;
      continue;
    }

    const kind: EvalCaseKind =
      holdoutEveryNth > 0 && (generatedIndex + 1) % holdoutEveryNth === 0 ? 'holdout' : primaryKind;

    deps.addCase(query, [view.id], {
      kind,
      language: languageFromTags(view.tags),
    });
    covered.add(view.id);
    created += 1;
    generatedIndex += 1;
  }

  return { created, skippedExisting, consideredNodes };
};

const deriveQuery = (view: GraphKnowledgeView): string | null => {
  const title = view.title?.trim();
  if (title && title.length >= MIN_TITLE_LENGTH) return title;
  // Fall back to the first sentence of the summary for nodes with terse titles.
  const summary = view.summary?.trim();
  if (summary && summary.length >= MIN_TITLE_LENGTH) {
    return summary.split(/[。.\n]/)[0].trim().slice(0, 120);
  }
  return null;
};

const KNOWN_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'ruby',
  'php', 'csharp', 'cpp', 'c', 'swift', 'kotlin', 'vue', 'svelte',
]);

const languageFromTags = (tags: string[]): string | undefined =>
  tags.map((tag) => tag.toLowerCase()).find((tag) => KNOWN_LANGUAGES.has(tag));
