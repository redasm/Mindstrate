/**
 * Custom (user-supplied) system page loading.
 *
 * Lets a project ship business-system level architecture pages
 * (combat / UI / map / config / asset-loading / network / ...) that
 * Mindstrate cannot generate from generic templates, by dropping JSON
 * files into `<project-root>/.mindstrate/system-pages/`.
 *
 * Each `*.json` file in that directory becomes one
 * `SystemPageDefinition` and is internalized into a deterministic
 * `architecture:system-page:<project>:<key>` RULE node alongside the
 * built-in 8 pages, so MCP retrieval (assemble / before-edit /
 * search_graph_knowledge) returns project-specific guidance for the
 * business systems.
 *
 * File schema (all fields optional except `key`):
 *
 * ```json
 * {
 *   "key": "10-combat",
 *   "name": "10-combat.md",
 *   "title": "Combat System",
 *   "body": ["## Purpose", "", "- ..."],
 *   "overlays": ["- kind: convention", "  content: ..."],
 *   "metadata": {
 *     "classifications": ["combat-system"],
 *     "knownConstraints": ["GAS attribute sets are generated; do not edit."],
 *     "doNotEditTargets": ["Source/Combat/Generated/**"],
 *     "affectedChain": "GAS C++ -> ASComponent -> Blueprint widgets",
 *     "sourceOfTruth": ["Source/Combat/Public/*.h"],
 *     "recommendedVerification": ["Run combat smoke test in PIE."],
 *     "tags": ["combat", "gas"]
 *   }
 * }
 * ```
 *
 * Defensive design:
 *   - Files that are not JSON or are missing `key` are silently
 *     skipped (the loader does not abort the whole projection).
 *   - A custom file using a built-in key (e.g. `00-overview`)
 *     overrides the generated definition for that key. This is
 *     intentional: it lets a project replace the generic Unreal-flavoured
 *     overview with their own.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { safeJson } from '../project/detection-support.js';
import type { DetectedProject } from '../project/index.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
import {
  normalizeSystemPageMetadata,
  systemPageString,
  systemPageStringArray,
} from './system-page-metadata.js';

export const CUSTOM_SYSTEM_PAGES_DIR = path.join('.mindstrate', 'system-pages');

const DEFAULT_USER_NOTES_PLACEHOLDER = '- Add project-specific confirmations, corrections, or open questions here.';
const DEFAULT_USER_NOTES_TITLE = 'User Notes';
const DEFAULT_OVERLAY_TITLE = 'Structured Overlay';

/**
 * Load all custom system page definitions from
 * `<project.root>/.mindstrate/system-pages/*.json`. Returns an empty
 * array when the directory does not exist.
 */
export const loadCustomSystemPages = (project: DetectedProject): SystemPageDefinition[] => {
  const dir = path.join(project.root, CUSTOM_SYSTEM_PAGES_DIR);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];

  const result: SystemPageDefinition[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
    const filePath = path.join(dir, entry.name);
    const raw = safeJson(filePath);
    const definition = parseCustomSystemPage(raw, entry.name);
    if (definition) result.push(definition);
  }
  // Stable ordering by key so projection writes (and node ids) are
  // deterministic regardless of filesystem traversal order.
  return result.sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * Merge the built-in pages with custom user pages. A custom page using
 * the same `key` as a built-in one fully replaces the built-in entry.
 */
export const mergeSystemPages = (
  builtIn: SystemPageDefinition[],
  custom: SystemPageDefinition[],
): SystemPageDefinition[] => {
  const byKey = new Map<string, SystemPageDefinition>();
  for (const page of builtIn) byKey.set(page.key, page);
  for (const page of custom) byKey.set(page.key, page);
  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
};

const parseCustomSystemPage = (raw: unknown, fileName: string): SystemPageDefinition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const key = systemPageString(value['key']);
  if (!key) return null;

  const title = systemPageString(value['title']) ?? key;
  const name = systemPageString(value['name']) ?? `${key}.md`;
  const body = systemPageStringArray(value['body']);
  const overlays = systemPageStringArray(value['overlays']);
  const userNotesPlaceholder = systemPageString(value['userNotesPlaceholder']) ?? DEFAULT_USER_NOTES_PLACEHOLDER;
  const userNotesTitle = systemPageString(value['userNotesTitle']) ?? DEFAULT_USER_NOTES_TITLE;
  const overlayTitle = systemPageString(value['overlayTitle']) ?? DEFAULT_OVERLAY_TITLE;
  const metadata = normalizeSystemPageMetadata(value['metadata']);

  return {
    key,
    name,
    title,
    body,
    overlays,
    userNotesPlaceholder,
    userNotesTitle,
    overlayTitle,
    metadata,
    sourceFile: fileName,
  };
};
