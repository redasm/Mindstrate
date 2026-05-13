/**
 * Project-graph Obsidian projection orchestrator.
 *
 * Coordinates the focused page writers in this folder
 * (`obsidian-system-pages.ts`, `obsidian-module-pages.ts`,
 * `obsidian-node-pages.ts`, `obsidian-flow-binding-pages.ts`,
 * `obsidian-projection-index.ts`) so the projection of one project graph
 * lands consistently under `<vaultRoot>/<projectSlug>/architecture/` and
 * the vault index gets refreshed in lock-step.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectionTarget,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { listProjectGraphOverlays } from './overlay.js';
import { collectProjectGraphArtifact } from './project-graph-artifact-collector.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import type { SystemPageDefinition } from './obsidian-system-page-types.js';
import { internalizeSystemPagesAsRules } from './internalize-system-pages.js';
import {
  renderEditableObsidianProjection,
  renderProjectGraphReport,
} from './project-graph-report-renderer.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';
import type { ProjectGraphArtifactResult } from './project-graph-report-types.js';
import { collectProjectGraphStats } from './project-graph-stats.js';
import {
  importExistingSystemPageOverlays,
  systemPageDefinitionsForProject,
  writeObsidianSystemPages,
} from './obsidian-system-pages.js';
import { writeObsidianModulePages } from './obsidian-module-pages.js';
import { writeObsidianNodePages } from './obsidian-node-pages.js';
import {
  importExistingSummaryPageOverlays,
  writeObsidianFlowAndBindingPages,
} from './obsidian-flow-binding-pages.js';
import { writeObsidianProjectionIndex } from './obsidian-projection-index.js';

export interface ProjectGraphObsidianProjectionOptions {
  systemPages?: SystemPageDefinition[];
}

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  options: ProjectGraphObsidianProjectionOptions = {},
): ProjectGraphArtifactResult => {
  const projectSlug = slugifyProjectGraphValue(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const plannedSystemPages = options.systemPages && options.systemPages.length > 0
    ? options.systemPages
    : systemPageDefinitionsForProject(project);
  // Internalize the planned system pages into ECS RULE nodes BEFORE the
  // overlay re-import sweep, so MCP retrieval (assemble / before-edit /
  // search_graph_knowledge) sees them as project-specific architecture
  // rules rather than orphan Markdown files.
  internalizeSystemPagesAsRules(store, project.name, plannedSystemPages);
  importProjectGraphOverlayBlock(store, project.name, existing);
  importExistingSystemPageOverlays(
    store,
    project,
    vaultRoot,
    projectSlug,
    plannedSystemPages.map((page) => page.name),
  );
  importExistingSummaryPageOverlays(store, project.name, vaultRoot, projectSlug);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);
  const nodePaths = writeObsidianNodePages(graph, vaultRoot, projectSlug, overlays);
  const flowAndBindingPaths = writeObsidianFlowAndBindingPages(graph, vaultRoot, projectSlug);
  const systemPages = writeObsidianSystemPages(vaultRoot, projectSlug, plannedSystemPages, project);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  writeObsidianProjectionIndex(vaultRoot, projectSlug, [
    { key: 'project-graph', path: reportPath, role: 'project-graph', priority: 100 },
    ...systemPages.map((page, index) => ({ key: `system:${page.key}`, path: page.path, role: 'system', priority: 95 - index })),
    ...flowAndBindingPaths.map((filePath) => ({
      key: `relationship:${path.basename(filePath, '.md')}`,
      path: filePath,
      role: filePath.endsWith('.generated.md') ? 'generated-detail' : 'summary',
      priority: filePath.endsWith('.generated.md') ? 40 : 80,
    })),
    { key: 'nodes:index', path: nodePaths[0], role: 'node-index', priority: 50 },
  ]);
  if (stats.projectionNodeId) {
    store.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_OBSIDIAN}:${project.name}`,
      nodeId: stats.projectionNodeId,
      target: ProjectionTarget.PROJECT_GRAPH_OBSIDIAN,
      targetRef: reportPath,
      version: 1,
      projectedAt: stats.generatedAt,
    });
  }

  return {
    reportPath,
    statsPath,
    graphPath,
    modulePaths,
    nodePaths,
    nodes: stats.nodes,
    edges: stats.edges,
  };
};
