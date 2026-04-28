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

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  KnowledgeType,
  CaptureSource,
  type CreateKnowledgeInput,
} from '@mindstrate/protocol';
import type { DetectedProject } from './detector.js';
import { truncateText } from '../text-format.js';
import {
  PRESERVE_CLOSE,
  PRESERVE_OPEN,
  extractPreserveBlocks,
  type PreservedBlocks,
} from './snapshot-preserve.js';

export { PRESERVE_CLOSE, PRESERVE_OPEN, extractPreserveBlocks } from './snapshot-preserve.js';

/**
 * Compute a stable knowledge id for the given project root.
 * Same root + same name -> same id, across machines.
 */
export function projectSnapshotId(project: DetectedProject): string {
  const norm = path.resolve(project.root).replace(/\\/g, '/').toLowerCase();
  const sig = `mindstrate:project-snapshot:${norm}:${project.name}`;
  const hash = crypto.createHash('sha1').update(sig).digest('hex');
  // Format like a UUID while remaining deterministic.
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // RFC4122 variant: set the version nibble to 5 (name-based / SHA-1).
    '5' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

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
    tags: buildTags(project),
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

  return { input, id, changed: !solutionsEqual(previous, solution) };
}

// ============================================================
// Markdown rendering
// ============================================================

function snapshotTitle(p: DetectedProject): string {
  const stack = [p.language, p.framework].filter(Boolean).join(' / ');
  return stack
    ? `Project Snapshot: ${p.name} — ${stack}`
    : `Project Snapshot: ${p.name}`;
}

function renderSnapshotMarkdown(
  p: DetectedProject,
  preserved: PreservedBlocks,
): string {
  const lines: string[] = [];

  // ---- Overview ----
  lines.push('## Overview');
  lines.push('');
  if (p.description) lines.push(p.description);
  if (p.readmeExcerpt) {
    if (p.description) lines.push('');
    lines.push(p.readmeExcerpt);
  }
  if (!p.description && !p.readmeExcerpt) {
    lines.push(`Project _${p.name}_ at \`${path.basename(p.root)}\`.`);
  }
  lines.push('');

  // ---- Tech Stack ----
  lines.push('## Tech Stack');
  lines.push('');
  if (p.language) lines.push(`- **Language:** ${p.language}`);
  if (p.framework) lines.push(`- **Framework:** ${p.framework}`);
  if (p.runtime) lines.push(`- **Runtime:** ${p.runtime}`);
  if (p.packageManager) lines.push(`- **Package manager:** ${p.packageManager}`);
  if (p.version) lines.push(`- **Version:** ${p.version}`);
  if (p.git?.isRepo && p.git.branch) {
    lines.push(`- **Git branch:** ${p.git.branch}${p.git.remote ? ` (\`${p.git.remote}\`)` : ''}`);
  }
  lines.push('');

  // ---- Dependencies ----
  if (p.dependencies.length) {
    lines.push('## Dependencies');
    lines.push('');
    const prod = p.dependencies.filter((d) => d.kind === 'prod');
    const dev = p.dependencies.filter((d) => d.kind === 'dev');
    const opt = p.dependencies.filter((d) => d.kind === 'optional');
    if (prod.length) {
      lines.push('**Runtime:**');
      for (const d of prod) lines.push(`- \`${d.name}\` ${d.version}`);
      lines.push('');
    }
    if (dev.length) {
      lines.push('**Dev:**');
      for (const d of dev) lines.push(`- \`${d.name}\` ${d.version}`);
      lines.push('');
    }
    if (opt.length) {
      lines.push('**Optional:**');
      for (const d of opt) lines.push(`- \`${d.name}\` ${d.version}`);
      lines.push('');
    }
    if (p.truncatedDeps > 0) {
      lines.push(`_(+${p.truncatedDeps} more dependencies omitted)_`);
      lines.push('');
    }
  }

  // ---- Entry points ----
  if (p.entryPoints.length) {
    lines.push('## Entry Points');
    lines.push('');
    for (const e of p.entryPoints) lines.push(`- \`${e}\``);
    lines.push('');
  }

  // ---- Scripts ----
  const scriptKeys = Object.keys(p.scripts);
  if (scriptKeys.length) {
    lines.push('## Scripts');
    lines.push('');
    for (const k of scriptKeys.slice(0, 20)) {
      lines.push(`- \`${k}\` → \`${truncateText(p.scripts[k], 80, '…')}\``);
    }
    lines.push('');
  }

  // ---- Top-level layout ----
  if (p.topDirs.length) {
    lines.push('## Directory Layout');
    lines.push('');
    for (const d of p.topDirs) lines.push(`- \`${d}/\``);
    lines.push('');
  }

  // ---- Workspaces ----
  if (p.workspaces?.length) {
    lines.push('## Workspaces');
    lines.push('');
    for (const w of p.workspaces) lines.push(`- \`${w}\``);
    lines.push('');
  }

  // ---- Architecture & Lifecycle (preservable) ----
  lines.push('## Architecture & Lifecycle');
  lines.push('');
  lines.push('_Document how this project boots, what owns each resource, and how data flows._');
  lines.push('');
  lines.push(PRESERVE_OPEN);
  lines.push(preserved.architecture ?? '<!-- Add or refine your architecture notes here. They are kept across `mindstrate init` re-runs. -->');
  lines.push(PRESERVE_CLOSE);
  lines.push('');

  // ---- Critical Invariants (preservable) ----
  lines.push('## Critical Invariants');
  lines.push('');
  lines.push('_Properties that hold globally across the system. AI assistants should NOT add defensive code that contradicts these._');
  lines.push('');
  lines.push(PRESERVE_OPEN);
  lines.push(preserved.invariants ?? [
    '<!-- Examples (delete and replace with your own):',
    '- The Model singleton is initialized at startup; runtime code may assume it is non-null.',
    '- Configuration is frozen after boot; do not mutate it from request handlers.',
    '- All DB writes go through the repository layer; never call the driver directly.',
    '-->',
  ].join('\n'));
  lines.push(PRESERVE_CLOSE);
  lines.push('');

  // ---- Conventions (preservable) ----
  lines.push('## Conventions');
  lines.push('');
  lines.push(PRESERVE_OPEN);
  lines.push(preserved.conventions ?? '<!-- e.g. file naming, error handling, logging, test layout, commit message format -->');
  lines.push(PRESERVE_CLOSE);
  lines.push('');

  // ---- Notes (preservable) ----
  lines.push('## Notes');
  lines.push('');
  lines.push(PRESERVE_OPEN);
  lines.push(preserved.notes ?? '<!-- Free-form notes preserved across `mindstrate init` runs. -->');
  lines.push(PRESERVE_CLOSE);
  lines.push('');

  // ---- Footer ----
  lines.push('---');
  lines.push(`_Detected: ${p.detectedAt} • Manifest: ${p.manifestPath ?? '(none)'} • Root: \`${p.root}\`_`);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function buildTags(p: DetectedProject): string[] {
  const tags = new Set<string>(['project-snapshot']);
  if (p.language) tags.add(p.language);
  if (p.framework) tags.add(p.framework);
  if (p.packageManager) tags.add(p.packageManager);
  return Array.from(tags);
}

/**
 * Compare two solution strings ignoring trailing whitespace differences and
 * the dynamic "_Detected: ..._" footer line.
 */
function solutionsEqual(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

function normalize(s: string): string {
  return s
    .replace(/_Detected: [^\n]*_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
