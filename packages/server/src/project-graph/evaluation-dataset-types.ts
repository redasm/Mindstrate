/**
 * Project graph evaluation dataset — public types.
 *
 * Pulled out so fixtures, tasks, runner, and renderer can each live in their
 * own file without sharing a 600-line "everything" module.
 */

import type { ContextEdge, ContextNode } from '@mindstrate/protocol/models';
import type { ProjectGraphIndexResult } from './project-graph-service.js';

export type ProjectGraphEvaluationFixtureId =
  | 'react-vite'
  | 'vue-vite'
  | 'next-app'
  | 'node-service'
  | 'unreal-game'
  | 'unreal-mixed-bindings';

export interface ProjectGraphEvaluationFixture {
  id: ProjectGraphEvaluationFixtureId;
  label: string;
  projectName: string;
  description: string;
  files: Record<string, string>;
  expected: ProjectGraphFixtureExpectations;
}

export interface ProjectGraphFixtureExpectations {
  framework?: string;
  minFilesScanned: number;
  minProjectGraphNodes: number;
  minProjectGraphEdges: number;
  requiredNodeTitles: string[];
  requiredEdges?: Array<{ sourceTitle: string; targetTitle: string; kind: string }>;
  requiredEntryPoints?: string[];
  requiredModulePageNames?: string[];
  requiredReportSnippets?: string[];
}

export interface ProjectGraphFixtureEvaluationInput {
  indexResult: ProjectGraphIndexResult;
  nodes: ContextNode[];
  edges: ContextEdge[];
  modulePagePaths?: string[];
  reportMarkdown?: string;
}

export interface ProjectGraphFixtureEvaluationResult {
  fixtureId: ProjectGraphEvaluationFixtureId;
  passed: boolean;
  failures: string[];
  metrics: ProjectGraphFixtureMetrics;
}

export interface ProjectGraphFixtureMetrics {
  filesScanned: number;
  projectGraphNodes: number;
  projectGraphEdges: number;
}

export type ProjectGraphEvaluationMode = 'legacy_snapshot' | 'project_graph';

export interface ProjectGraphEvaluationTask {
  id: string;
  fixtureId: ProjectGraphEvaluationFixtureId;
  mode: 'compare_legacy_snapshot_to_project_graph';
  title: string;
  legacyPrompt: string;
  graphPrompt: string;
  expectedFiles: string[];
  avoidFiles: string[];
  successCriteria: string[];
}

export interface ProjectGraphEvaluationRun {
  taskId: string;
  mode: ProjectGraphEvaluationMode;
  success: boolean;
  filesOpened: string[];
  elapsedMs: number;
  notes?: string;
}

export interface ProjectGraphEvaluationModeMetrics {
  runs: number;
  successRate: number;
  averageFilesOpened: number;
  wrongFilesOpened: number;
  averageTimeToAnswerMs: number;
}

export interface ProjectGraphEvaluationRunSummary {
  totalRuns: number;
  byMode: Record<ProjectGraphEvaluationMode, ProjectGraphEvaluationModeMetrics>;
  comparison: {
    successRateDelta: number;
    averageFilesOpenedDelta: number;
    wrongFilesOpenedDelta: number;
    averageTimeToAnswerMsDelta: number;
  };
}

export interface RenderProjectGraphEvaluationDatasetInput {
  fixtures: ProjectGraphEvaluationFixture[];
  tasks: ProjectGraphEvaluationTask[];
  summary?: ProjectGraphEvaluationRunSummary;
}
