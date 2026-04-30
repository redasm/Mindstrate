import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  ProjectionTarget,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphModules } from './clustering.js';
import { listProjectGraphOverlays } from './overlay.js';
import { collectProjectGraphArtifact } from './project-graph-artifact.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { importProjectGraphOverlayBlock } from './project-graph-overlay-import.js';
import {
  renderEditableModulePage,
  renderEditableObsidianProjection,
  renderProjectGraphReport,
} from './project-graph-report-renderer.js';
import { slugifyProjectGraphValue } from './project-graph-report-shared.js';
import type { ProjectGraphArtifactResult } from './project-graph-report-types.js';
import { collectProjectGraphStats } from './project-graph-stats.js';

export const writeProjectGraphObsidianProjection = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
): ProjectGraphArtifactResult => {
  const projectSlug = slugifyProjectGraphValue(project.name);
  const reportPath = path.join(vaultRoot, projectSlug, 'architecture', 'project-graph.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const existing = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  importProjectGraphOverlayBlock(store, project.name, existing);
  const stats = collectProjectGraphStats(store, project);
  const generated = renderProjectGraphReport(project, stats);
  const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
  const report = renderEditableObsidianProjection(generated, existing, overlays);
  const graph = collectProjectGraphArtifact(store, project, stats);
  const modulePaths = writeObsidianModulePages(store, project, vaultRoot, projectSlug);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
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
    nodes: stats.nodes,
    edges: stats.edges,
  };
};

const writeObsidianModulePages = (
  store: ContextGraphStore,
  project: DetectedProject,
  vaultRoot: string,
  projectSlug: string,
): string[] => {
  const modules = collectProjectGraphModules(store, project.name);
  return modules.map((module) => {
    const modulePath = path.join(
      vaultRoot,
      projectSlug,
      'architecture',
      'modules',
      `${slugifyProjectGraphValue(module.label)}.md`,
    );
    const existing = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
    const overlays = listProjectGraphOverlays(store, { project: project.name, limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT });
    writeProjectGraphTextFileAtomically(modulePath, renderEditableModulePage(module, overlays, existing));
    return modulePath;
  });
};
