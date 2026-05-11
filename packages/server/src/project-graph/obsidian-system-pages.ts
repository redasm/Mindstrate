/**
 * Obsidian "system pages" (00-overview ... 07-risky-files) writer.
 *
 * Owns three concerns kept together because they all manipulate the same
 * `<vault>/<project>/architecture/` directory and share the planned page
 * list:
 *  - Re-import overlays from existing system pages so user-edited overlay
 *    blocks survive a re-projection.
 *  - Resolve the locale-specific definition list when the caller did not
 *    pass a planned set explicitly.
 *  - Render and atomically write each page, preserving the user-notes and
 *    overlay blocks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { enSystemPageDefinitions } from './obsidian-system-pages-en.js';
import { zhSystemPageDefinitions } from './obsidian-system-pages-zh.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import { preserveProjectGraphBlock } from './project-graph-report-shared.js';
import { resolveProjectGraphLocale } from './project-graph-locale.js';

export interface WrittenSystemPage {
  key: string;
  path: string;
}

export const systemPageDefinitionsForProject = (project: DetectedProject): SystemPageDefinition[] => {
  const generatedRoots = project.graphHints?.generatedRoots ?? ['Binaries', 'Intermediate', 'Saved', 'DerivedDataCache', 'TypeScript/Typing'];
  return resolveProjectGraphLocale() === 'zh'
    ? zhSystemPageDefinitions(project, generatedRoots)
    : enSystemPageDefinitions(project, generatedRoots);
};

/**
 * Names of every Markdown page the system-page writer is allowed to touch
 * for `projectSlug`. Derived from the locale generators at call time so
 * adding/renaming a page in `obsidian-system-pages-{en,zh}.ts` is picked up
 * here without a second hardcoded list to keep in sync.
 */
export const knownSystemPageNames = (project: DetectedProject): Set<string> => {
  const generatedRoots = project.graphHints?.generatedRoots ?? [];
  return new Set([
    ...enSystemPageDefinitions(project, generatedRoots).map((page) => page.name),
    ...zhSystemPageDefinitions(project, generatedRoots).map((page) => page.name),
  ]);
};

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
): WrittenSystemPage[] => {
  const architectureDir = path.join(vaultRoot, projectSlug, 'architecture');
  const written: WrittenSystemPage[] = [];
  for (const page of plannedPages) {
    const pagePath = path.join(architectureDir, page.name);
    const existing = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
    writeProjectGraphTextFileAtomically(pagePath, renderSystemPage(page, existing));
    written.push({ key: page.key, path: pagePath });
  }
  return written;
};

const renderSystemPage = (page: SystemPageDefinition, existing: string): string => [
  '<!-- mindstrate:project-graph:system-generated:start -->',
  `# ${page.title}`,
  '',
  ...page.body,
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
