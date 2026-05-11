/**
 * Project graph evaluation runner.
 * Materialises fixtures on disk and evaluates extraction results against
 * fixture expectations, plus aggregates per-mode metrics across runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { PROJECT_GRAPH_METADATA_KEYS, isProjectGraphEdge, isProjectGraphNode } from '@mindstrate/protocol/models';
import { PROJECT_GRAPH_EVALUATION_FIXTURES } from './evaluation-fixtures.js';
import { PROJECT_GRAPH_EVALUATION_TASKS } from './evaluation-tasks.js';
import type {
  ProjectGraphEvaluationFixture,
  ProjectGraphEvaluationFixtureId,
  ProjectGraphEvaluationModeMetrics,
  ProjectGraphEvaluationRun,
  ProjectGraphEvaluationRunSummary,
  ProjectGraphEvaluationTask,
  ProjectGraphFixtureEvaluationInput,
  ProjectGraphFixtureEvaluationResult,
} from './evaluation-dataset-types.js';

export const listProjectGraphEvaluationFixtures = (): ProjectGraphEvaluationFixture[] =>
  PROJECT_GRAPH_EVALUATION_FIXTURES.map((fixture) => ({
    ...fixture,
    files: { ...fixture.files },
    expected: {
      ...fixture.expected,
      requiredNodeTitles: [...fixture.expected.requiredNodeTitles],
      requiredEdges: fixture.expected.requiredEdges?.map((edge) => ({ ...edge })),
      requiredEntryPoints: fixture.expected.requiredEntryPoints ? [...fixture.expected.requiredEntryPoints] : undefined,
      requiredModulePageNames: fixture.expected.requiredModulePageNames ? [...fixture.expected.requiredModulePageNames] : undefined,
      requiredReportSnippets: fixture.expected.requiredReportSnippets ? [...fixture.expected.requiredReportSnippets] : undefined,
    },
  }));

export const getProjectGraphEvaluationFixture = (
  id: ProjectGraphEvaluationFixtureId,
): ProjectGraphEvaluationFixture => {
  const fixture = listProjectGraphEvaluationFixtures().find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Unknown project graph evaluation fixture: ${id}`);
  return fixture;
};

export const listProjectGraphEvaluationTasks = (): ProjectGraphEvaluationTask[] =>
  PROJECT_GRAPH_EVALUATION_TASKS.map((entry) => ({
    ...entry,
    expectedFiles: [...entry.expectedFiles],
    avoidFiles: [...entry.avoidFiles],
    successCriteria: [...entry.successCriteria],
  }));

export const materializeProjectGraphEvaluationFixture = (
  id: ProjectGraphEvaluationFixtureId,
  root: string,
): ProjectGraphEvaluationFixture => {
  const fixture = getProjectGraphEvaluationFixture(id);
  for (const [rel, content] of Object.entries(fixture.files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return fixture;
};

export const evaluateProjectGraphFixture = (
  fixture: ProjectGraphEvaluationFixture,
  input: ProjectGraphFixtureEvaluationInput,
): ProjectGraphFixtureEvaluationResult => {
  const projectGraphNodes = input.nodes.filter(isProjectGraphNode);
  const projectGraphEdges = input.edges.filter(isProjectGraphEdge);
  const nodeTitles = new Set(projectGraphNodes.map((node) => node.title));
  const nodeById = new Map(projectGraphNodes.map((node) => [node.id, node]));
  const modulePageNames = new Set((input.modulePagePaths ?? []).map((filePath) => path.basename(filePath)));
  const report = input.reportMarkdown ?? '';
  const failures = [
    ...minFailure('files scanned', input.indexResult.filesScanned, fixture.expected.minFilesScanned),
    ...minFailure('project graph nodes', projectGraphNodes.length, fixture.expected.minProjectGraphNodes),
    ...minFailure('project graph edges', projectGraphEdges.length, fixture.expected.minProjectGraphEdges),
    ...fixture.expected.requiredNodeTitles
      .filter((title) => !nodeTitles.has(title))
      .map((title) => `missing node title: ${title}`),
    ...(fixture.expected.requiredEdges ?? [])
      .filter((expected) => !projectGraphEdges.some((edge) => {
        const source = nodeById.get(edge.sourceId);
        const target = nodeById.get(edge.targetId);
        return source?.title === expected.sourceTitle
          && target?.title === expected.targetTitle
          && edge.evidence?.[PROJECT_GRAPH_METADATA_KEYS.kind] === expected.kind;
      }))
      .map((edge) => `missing edge: ${edge.sourceTitle} -[${edge.kind}]-> ${edge.targetTitle}`),
    ...(fixture.expected.requiredEntryPoints ?? [])
      .filter((entry) => !nodeTitles.has(entry))
      .map((entry) => `missing entry point: ${entry}`),
    ...(fixture.expected.requiredModulePageNames ?? [])
      .filter((name) => input.modulePagePaths && !modulePageNames.has(name))
      .map((name) => `missing module page: ${name}`),
    ...(fixture.expected.requiredReportSnippets ?? [])
      .filter((snippet) => input.reportMarkdown && !reportIncludesSnippet(report, snippet))
      .map((snippet) => `missing report snippet: ${snippet}`),
  ];

  return {
    fixtureId: fixture.id,
    passed: failures.length === 0,
    failures,
    metrics: {
      filesScanned: input.indexResult.filesScanned,
      projectGraphNodes: projectGraphNodes.length,
      projectGraphEdges: projectGraphEdges.length,
    },
  };
};

export const summarizeProjectGraphEvaluationRuns = (
  tasks: ProjectGraphEvaluationTask[],
  runs: ProjectGraphEvaluationRun[],
): ProjectGraphEvaluationRunSummary => {
  const taskById = new Map(tasks.map((entry) => [entry.id, entry]));
  const byMode = {
    legacy_snapshot: summarizeMode(taskById, runs.filter((run) => run.mode === 'legacy_snapshot')),
    project_graph: summarizeMode(taskById, runs.filter((run) => run.mode === 'project_graph')),
  };
  return {
    totalRuns: runs.length,
    byMode,
    comparison: {
      successRateDelta: byMode.project_graph.successRate - byMode.legacy_snapshot.successRate,
      averageFilesOpenedDelta: byMode.project_graph.averageFilesOpened - byMode.legacy_snapshot.averageFilesOpened,
      wrongFilesOpenedDelta: byMode.project_graph.wrongFilesOpened - byMode.legacy_snapshot.wrongFilesOpened,
      averageTimeToAnswerMsDelta: byMode.project_graph.averageTimeToAnswerMs - byMode.legacy_snapshot.averageTimeToAnswerMs,
    },
  };
};

const minFailure = (label: string, actual: number, expected: number): string[] =>
  actual >= expected ? [] : [`${label}: expected at least ${expected}, got ${actual}`];

const reportIncludesSnippet = (report: string, snippet: string): boolean => {
  if (report.includes(snippet)) return true;
  const aliases: Record<string, string[]> = {
    'Entry Points': ['入口点'],
    'Core Modules': ['核心模块'],
    'Native To Script Bindings': ['原生到脚本绑定'],
    'Asset And Blueprint Surfaces': ['资产与蓝图表面'],
  };
  return (aliases[snippet] ?? []).some((alias) => report.includes(alias));
};

const summarizeMode = (
  taskById: Map<string, ProjectGraphEvaluationTask>,
  runs: ProjectGraphEvaluationRun[],
): ProjectGraphEvaluationModeMetrics => {
  if (runs.length === 0) {
    return {
      runs: 0,
      successRate: 0,
      averageFilesOpened: 0,
      wrongFilesOpened: 0,
      averageTimeToAnswerMs: 0,
    };
  }

  const wrongFilesOpened = runs.reduce((sum, run) => {
    const task = taskById.get(run.taskId);
    if (!task) return sum;
    const opened = new Set(run.filesOpened);
    return sum + task.avoidFiles.filter((file) => opened.has(file)).length;
  }, 0);

  return {
    runs: runs.length,
    successRate: runs.filter((run) => run.success).length / runs.length,
    averageFilesOpened: average(runs.map((run) => run.filesOpened.length)),
    wrongFilesOpened,
    averageTimeToAnswerMs: average(runs.map((run) => run.elapsedMs)),
  };
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

