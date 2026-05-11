/**
 * Obsidian per-module pages writer (`architecture/modules/<slug>.md`).
 *
 * Each module page is overlay-aware and preserves user-edited blocks
 * across re-projections via `renderEditableModulePage`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROJECT_GRAPH_DEFAULT_QUERY_LIMIT } from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphModules } from './clustering.js';
import { listProjectGraphOverlays } from './overlay.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { renderEditableModulePage } from './project-graph-report-renderer.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';

export const writeObsidianModulePages = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
): string[] => {
  const modules = collectProjectGraphModules(store, project.name);
  const overlays = listProjectGraphOverlays(store, {
    project: project.name,
    limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  });
  return modules.map((module) => {
    const modulePath = path.join(
      vaultRoot,
      projectSlug,
      'architecture',
      'modules',
      `${slugifyProjectGraphValue(module.label)}.md`,
    );
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    writeProjectGraphTextFileAtomically(modulePath, renderEditableModulePage(module, overlays, existing));
    return modulePath;
  });
};
