/**
 * Obsidian "system pages" writer.
 *
 * Three-layer composition (low → high priority; same `key` overrides):
 *
 *   1. Generic language-agnostic skeleton (`obsidian-system-pages-generic.ts`).
 *      Always written. Uses only `DetectedProject` fields, never names a
 *      stack.
 *   2. Stack architecture preset from the matched detection rule's
 *      `systemPagesInclude` file (e.g. `unreal-architecture-pages.json`).
 *      A non-Unreal project gets nothing here, so the skeleton stays.
 *   3. User pages from `<project>/.mindstrate/system-pages/*.json`. Wins
 *      over both layers above so a project can replace either.
 *
 * Body templating: page bodies may carry these placeholder lines, which
 * the renderer expands at write time so the JSON preset stays
 * declarative and locale-agnostic about runtime data.
 *   - `${project.name}` / `${project.framework}` / `${project.language}`
 *     in `title`.
 *   - `<!-- mindstrate:operation-manual -->` line in `body`: replaced by
 *     `renderProjectOperationManualSections(project)`.
 *   - `<!-- mindstrate:generated-roots -->` line in `body`: replaced by
 *     a bullet list of `project.graphHints?.generatedRoots`.
 *
 * See `docs/system-pages.md` for the user-facing customization guide.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject, RuleSystemPagePreset, SystemPagePresetLocale } from '../project/index.js';
import { genericSystemPageDefinitions } from './obsidian-system-pages-generic.js';
import type { SystemPageClassification, SystemPageDefinition } from './obsidian-system-page-types.js';
import { loadCustomSystemPages, mergeSystemPages } from './custom-system-pages.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import { preserveProjectGraphBlock } from './project-graph-report-shared.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';
import { renderProjectOperationManualSections } from './operation-manual.js';

export interface WrittenSystemPage {
  key: string;
  path: string;
}

const KNOWN_CLASSIFICATIONS = new Set<SystemPageClassification>([
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
]);

export const systemPageDefinitionsForProject = (project: DetectedProject): SystemPageDefinition[] => {
  const skeleton = genericSystemPageDefinitions(project);
  const stackPreset = stackPresetForProject(project);
  const custom = loadCustomSystemPages(project);
  // Order matters: later inputs override earlier ones via `mergeSystemPages`.
  return mergeSystemPages(mergeSystemPages(skeleton, stackPreset), custom);
};

/**
 * Names of every Markdown page the system-page writer is allowed to touch
 * for `projectSlug`. Derived from every layer (skeleton + rule preset +
 * custom) so renaming a page in any source is picked up here without a
 * second hardcoded list to keep in sync.
 */
export const knownSystemPageNames = (project: DetectedProject): Set<string> =>
  new Set(systemPageDefinitionsForProject(project).map((page) => page.name));

export const importExistingSystemPageOverlays = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
  plannedPageNames: string[] = [],
): void => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  const candidates = new Set<string>([...knownSystemPageNames(project), ...plannedPageNames]);
  for (const pageName of candidates) {
    const pagePath = path.join(architectureDir, pageName);
    if (fs.existsSync(pagePath)) {
      importProjectGraphOverlayBlock(store, project.name, fs.readFileSync(pagePath, 'utf8'));
    }
  }
};

export const writeObsidianSystemPages = (
  vaultRoot: string,
  projectSlug: string,
  plannedPages: SystemPageDefinition[],
  project: DetectedProject,
): WrittenSystemPage[] => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  const written: WrittenSystemPage[] = [];
  for (const page of plannedPages) {
    const pagePath = path.join(architectureDir, page.name);
    const existing = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
    writeProjectGraphTextFileAtomically(pagePath, renderSystemPage(page, existing, project));
    written.push({ key: page.key, path: pagePath });
  }
  return written;
};

/**
 * Resolve the stack-specific preset list for a project. Returns `[]`
 * when the rule does not provide one for the active locale.
 */
const stackPresetForProject = (project: DetectedProject): SystemPageDefinition[] => {
  const presets = project.graphHints?.systemPagePresets;
  if (!presets) return [];
  const locale: SystemPagePresetLocale = resolveProjectGraphLocale() === 'zh' ? 'zh' : 'en';
  // Fall back to the alternate locale rather than dropping the preset
  // entirely when the user runs in zh but the include file only ships
  // an `en` array (or vice versa). The translated body is still better
  // than the generic skeleton.
  const list = presets[locale] ?? presets[locale === 'en' ? 'zh' : 'en'] ?? [];
  return list.map(toSystemPageDefinition);
};

const toSystemPageDefinition = (preset: RuleSystemPagePreset): SystemPageDefinition => {
  const classifications = (preset.metadata?.classifications ?? [])
    .filter((entry): entry is SystemPageClassification => KNOWN_CLASSIFICATIONS.has(entry as SystemPageClassification));
  const metadata = preset.metadata
    ? {
      ...(classifications.length > 0 ? { classifications } : {}),
      ...(preset.metadata.triggers ? { triggers: preset.metadata.triggers } : {}),
      ...(preset.metadata.knownConstraints ? { knownConstraints: preset.metadata.knownConstraints } : {}),
      ...(preset.metadata.doNotEditTargets ? { doNotEditTargets: preset.metadata.doNotEditTargets } : {}),
      ...(preset.metadata.affectedChain ? { affectedChain: preset.metadata.affectedChain } : {}),
      ...(preset.metadata.sourceOfTruth ? { sourceOfTruth: preset.metadata.sourceOfTruth } : {}),
      ...(preset.metadata.recommendedVerification ? { recommendedVerification: preset.metadata.recommendedVerification } : {}),
      ...(preset.metadata.tags ? { tags: preset.metadata.tags } : {}),
    }
    : undefined;
  return {
    key: preset.key,
    name: preset.name,
    title: preset.title,
    body: preset.body,
    overlays: preset.overlays,
    userNotesPlaceholder: preset.userNotesPlaceholder,
    userNotesTitle: preset.userNotesTitle,
    overlayTitle: preset.overlayTitle,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
  };
};

const renderSystemPage = (page: SystemPageDefinition, existing: string, project: DetectedProject): string => [
  '<!-- mindstrate:project-graph:system-generated:start -->',
  `# ${expandProjectTokens(page.title, project)}`,
  '',
  ...expandBodyPlaceholders(page.body, project),
  '<!-- mindstrate:project-graph:system-generated:end -->',
  '',
  `## ${page.userNotesTitle}`,
  '',
  '<!-- mindstrate:project-graph:user-notes:start -->',
  preserveProjectGraphBlock(existing, 'user-notes') || page.userNotesPlaceholder,
  '<!-- mindstrate:project-graph:user-notes:end -->',
  '',
  `## ${page.overlayTitle}`,
  '',
  '<!-- mindstrate:project-graph:overlay:start -->',
  preserveProjectGraphBlock(existing, 'overlay') || page.overlays.join('\n'),
  '<!-- mindstrate:project-graph:overlay:end -->',
  '',
].join('\n');

/**
 * Expand the two declarative placeholder lines a JSON preset (or a
 * generic skeleton page) can carry. Keeps page authoring in JSON simple
 * while still letting per-project runtime data flow into the rendered
 * Markdown.
 */
const expandBodyPlaceholders = (body: string[], project: DetectedProject): string[] => {
  const result: string[] = [];
  for (const line of body) {
    if (line.trim() === '<!-- mindstrate:operation-manual -->') {
      result.push(...renderProjectOperationManualSections(project));
      continue;
    }
    if (line.trim() === '<!-- mindstrate:generated-roots -->') {
      const roots = project.graphHints?.generatedRoots ?? [];
      if (roots.length === 0) {
        result.push('- (no generated roots declared)');
      } else {
        for (const root of roots) result.push(`- ${root}`);
      }
      continue;
    }
    result.push(expandProjectTokens(line, project));
  }
  return result;
};

const expandProjectTokens = (value: string, project: DetectedProject): string => value
  .replace(/\$\{project\.name\}/g, project.name)
  .replace(/\$\{project\.framework\}/g, project.framework ?? 'unknown')
  .replace(/\$\{project\.language\}/g, project.language ?? 'unknown');
