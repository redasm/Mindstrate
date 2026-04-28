/**
 * Project Snapshot Generator
 *
 * Turns a DetectedProject into a knowledge unit that captures the project's
 * global mental model: tech stack, lifecycle, critical invariants, conventions,
 * entry points and directory layout.
 *
 * Why this matters: when an AI assistant edits a small piece of code, it
 * easily makes locally-correct changes that are globally wrong (e.g. adding
 * a null check that the rest of the system invariants make impossible).
 * The project snapshot KU is meant to be retrieved/curated at the start of
 * any non-trivial task so the AI has the global picture.
 *
 * Idempotency:
 *   - The snapshot KU has a deterministic id derived from
 *     the project root + project name. Re-running `mindstrate init` updates the
 *     same record instead of creating duplicates.
 *   - The body uses preserve markers around the "Critical Invariants" and
 *     "Notes" sections so user/AI edits are never overwritten.
 */

import {
  KnowledgeType,
  CaptureSource,
  type CreateKnowledgeInput,
} from '@mindstrate/protocol';
import type { DetectedProject } from './detector.js';
import { projectSnapshotId } from './snapshot-id.js';
import {
  buildSnapshotTags,
  renderSnapshotMarkdown,
  snapshotSolutionsEqual,
  snapshotTitle,
} from './snapshot-renderer.js';
import {
  PRESERVE_CLOSE,
  PRESERVE_OPEN,
  extractPreserveBlocks,
} from './snapshot-preserve.js';

export { PRESERVE_CLOSE, PRESERVE_OPEN, extractPreserveBlocks } from './snapshot-preserve.js';
export { projectSnapshotId } from './snapshot-id.js';

export interface SnapshotOptions {
  /** Existing solution body (used to extract preserve blocks for round-trip). */
  previousSolution?: string;
  /** When true, mark the KU as verified=true via initial confidence boost. */
  trusted?: boolean;
  /** Author label */
  author?: string;
}

export interface ProjectSnapshotResult {
  input: CreateKnowledgeInput;
  /** Stable id for upsert */
  id: string;
  /** True when this body differs from the previous solution */
  changed: boolean;
}

/**
 * Build a CreateKnowledgeInput representing the given project.
 */
export function buildProjectSnapshot(
  project: DetectedProject,
  opts: SnapshotOptions = {},
): ProjectSnapshotResult {
  const id = projectSnapshotId(project);
  const previous = opts.previousSolution ?? '';
  const preserved = extractPreserveBlocks(previous);

  const solution = renderSnapshotMarkdown(project, preserved);

  const input: CreateKnowledgeInput = {
    type: KnowledgeType.ARCHITECTURE,
    title: snapshotTitle(project),
    problem: 'AI assistants need a global mental model of this project to avoid '
      + 'making locally-correct but globally-wrong changes (e.g. defensive null '
      + 'checks for values that the system invariants guarantee non-null).',
    solution,
    tags: buildSnapshotTags(project),
    source: CaptureSource.AUTO_DETECT,
    author: opts.author ?? 'mindstrate-init',
    confidence: opts.trusted ? 0.9 : 0.7,
    context: {
      project: project.name,
      language: project.language,
      framework: project.framework,
      dependencies: project.dependencies.map((d) => d.name),
    },
    actionable: {
      preconditions: [
        'Before making any non-trivial change, retrieve this snapshot to understand the project as a whole.',
      ],
      steps: [
        'Read the "Architecture & Lifecycle" section to understand initialization order and resource scopes.',
        'Check "Critical Invariants" before adding defensive code: many "missing checks" are intentional.',
        'Follow "Conventions" for style, error handling and tests.',
      ],
      verification: 'Your change preserves every documented invariant and follows the conventions.',
      antiPatterns: [
        'Adding null/undefined checks for values that this snapshot lists as guaranteed non-null.',
        'Introducing dependencies or tools that conflict with the documented stack.',
        'Refactoring entry points without updating this snapshot.',
      ],
    },
  };

  return { input, id, changed: !snapshotSolutionsEqual(previous, solution) };
}
