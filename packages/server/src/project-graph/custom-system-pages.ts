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
import type {
  SystemPageClassification,
  SystemPageDefinition,
  SystemPageMetadata,
  SystemPageMetadataTriggers,
} from './obsidian-system-page-types.js';

export const CUSTOM_SYSTEM_PAGES_DIR = path.join('.mindstrate', 'system-pages');

const KNOWN_CLASSIFICATIONS: SystemPageClassification[] = [
  'generated-output',
  'project-manifest',
  'plugin-manifest',
  'build-module',
  'editor-boundary',
  'asset-reference-sensitive',
  'config-sensitive',
  'native-script-binding',
  'typescript-consumer',
  'cpp-source',
  'general-source',
];
const CLASSIFICATION_SET = new Set<string>(KNOWN_CLASSIFICATIONS);

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
  const key = stringOrUndefined(value['key']);
  if (!key) return null;

  const title = stringOrUndefined(value['title']) ?? key;
  const name = stringOrUndefined(value['name']) ?? `${key}.md`;
  const body = stringArray(value['body']);
  const overlays = stringArray(value['overlays']);
  const userNotesPlaceholder = stringOrUndefined(value['userNotesPlaceholder']) ?? DEFAULT_USER_NOTES_PLACEHOLDER;
  const userNotesTitle = stringOrUndefined(value['userNotesTitle']) ?? DEFAULT_USER_NOTES_TITLE;
  const overlayTitle = stringOrUndefined(value['overlayTitle']) ?? DEFAULT_OVERLAY_TITLE;
  const metadata = parseCustomMetadata(value['metadata']);

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

const parseCustomMetadata = (raw: unknown): SystemPageMetadata | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const classifications = stringArray(value['classifications'])
    .filter((entry): entry is SystemPageClassification => CLASSIFICATION_SET.has(entry));
  const metadata: SystemPageMetadata = {};
  if (classifications.length > 0) metadata.classifications = classifications;
  const triggers = parseTriggers(value['triggers']);
  if (triggers) metadata.triggers = triggers;
  const knownConstraints = stringArray(value['knownConstraints']);
  if (knownConstraints.length > 0) metadata.knownConstraints = knownConstraints;
  const doNotEditTargets = stringArray(value['doNotEditTargets']);
  if (doNotEditTargets.length > 0) metadata.doNotEditTargets = doNotEditTargets;
  const affectedChain = stringOrUndefined(value['affectedChain']);
  if (affectedChain) metadata.affectedChain = affectedChain;
  const sourceOfTruth = stringArray(value['sourceOfTruth']);
  if (sourceOfTruth.length > 0) metadata.sourceOfTruth = sourceOfTruth;
  const recommendedVerification = stringArray(value['recommendedVerification']);
  if (recommendedVerification.length > 0) metadata.recommendedVerification = recommendedVerification;
  const tags = stringArray(value['tags']);
  if (tags.length > 0) metadata.tags = tags;
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const parseTriggers = (raw: unknown): SystemPageMetadataTriggers | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const result: SystemPageMetadataTriggers = {};
  const extensions = stringArray(value['extensions']);
  if (extensions.length > 0) result.extensions = extensions;
  const pathContains = stringArray(value['pathContains']);
  if (pathContains.length > 0) result.pathContains = pathContains;
  const pathSuffix = stringArray(value['pathSuffix']);
  if (pathSuffix.length > 0) result.pathSuffix = pathSuffix;
  return Object.keys(result).length > 0 ? result : undefined;
};

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];
