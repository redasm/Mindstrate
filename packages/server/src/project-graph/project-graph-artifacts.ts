import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectionTarget } from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import type { DetectedProject } from '../project/index.js';
import { collectProjectGraphArtifact } from './project-graph-artifact.js';
import { writeProjectGraphTextFileAtomically } from './project-graph-file-io.js';
import { renderProjectGraphRepoEntry } from './project-graph-report-renderer.js';
import { collectProjectGraphStats } from './project-graph-stats.js';
import type { ProjectGraphArtifactResult } from './project-graph-report-types.js';

export const writeProjectGraphArtifacts = (
  store: ContextGraphStore,
  project: DetectedProject,
): ProjectGraphArtifactResult => {
  const stats = collectProjectGraphStats(store, project);
  const report = renderProjectGraphRepoEntry(project, stats);
  const reportPath = path.join(project.root, 'PROJECT_GRAPH.md');
  const statsPath = path.join(project.root, '.mindstrate', 'project-graph.json');
  const graphPath = path.join(project.root, '.mindstrate', 'project-graph.graph.json');
  const graph = collectProjectGraphArtifact(store, project, stats);

  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  writeProjectGraphTextFileAtomically(reportPath, report);
  writeProjectGraphTextFileAtomically(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  writeProjectGraphTextFileAtomically(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  if (stats.projectionNodeId) {
    store.upsertProjectionRecord({
      id: `projection:${ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY}:${project.name}`,
      nodeId: stats.projectionNodeId,
      target: ProjectionTarget.PROJECT_GRAPH_REPO_ENTRY,
      targetRef: reportPath,
      version: 1,
      projectedAt: stats.generatedAt,
    });
  }

  return {
    reportPath,
    statsPath,
    graphPath,
    modulePaths: [],
    nodes: stats.nodes,
    edges: stats.edges,
  };
};
