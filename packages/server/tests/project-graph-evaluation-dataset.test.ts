import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { ContextDomainType } from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import {
  evaluateProjectGraphFixture,
  listProjectGraphEvaluationFixtures,
  listProjectGraphEvaluationTasks,
  materializeProjectGraphEvaluationFixture,
  summarizeProjectGraphEvaluationRuns,
} from '../src/project-graph/evaluation-dataset.js';
import { createTempDir, removeTempDir } from './test-support.js';

describe('project graph evaluation dataset', () => {
  let root: string;
  let dataDir: string;
  let memory: Mindstrate;

  beforeEach(async () => {
    root = createTempDir('mindstrate-project-graph-eval-fixtures-');
    dataDir = createTempDir('mindstrate-project-graph-eval-data-');
    memory = new Mindstrate({ dataDir });
    await memory.init();
  });

  afterEach(() => {
    memory.close();
    removeTempDir(root);
    removeTempDir(dataDir);
  });

  it('publishes open fixture definitions for the Phase 6 project families', () => {
    expect(listProjectGraphEvaluationFixtures().map((fixture) => fixture.id)).toEqual([
      'react-vite',
      'vue-vite',
      'next-app',
      'node-service',
      'unreal-game',
    ]);
  });

  it('materializes fixtures and validates expected graph shape assertions', () => {
    for (const fixture of listProjectGraphEvaluationFixtures()) {
      const fixtureRoot = path.join(root, fixture.id);
      materializeProjectGraphEvaluationFixture(fixture.id, fixtureRoot);

      const project = detectProject(fixtureRoot);
      expect(project, fixture.id).not.toBeNull();
      expect(project?.name).toBe(fixture.projectName);
      expect(project?.framework).toBe(fixture.expected.framework);

      const indexResult = memory.context.indexProjectGraph(project!);
      const nodes = memory.context.listContextNodes({
        project: fixture.projectName,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: 1000,
      });
      const edges = memory.context.listContextEdges({ limit: 1000 });
      const result = evaluateProjectGraphFixture(fixture, {
        indexResult,
        nodes,
        edges,
      });

      expect(result.passed, `${fixture.id}: ${result.failures.join(', ')}`).toBe(true);
      expect(result.metrics.filesScanned).toBeGreaterThanOrEqual(fixture.expected.minFilesScanned);
      expect(result.metrics.projectGraphNodes).toBeGreaterThanOrEqual(fixture.expected.minProjectGraphNodes);
      expect(result.metrics.projectGraphEdges).toBeGreaterThanOrEqual(fixture.expected.minProjectGraphEdges);
    }
  });

  it('publishes before and after AI task prompts for every fixture', () => {
    const fixtureIds = new Set(listProjectGraphEvaluationFixtures().map((fixture) => fixture.id));
    const tasks = listProjectGraphEvaluationTasks();

    expect(tasks.length).toBeGreaterThanOrEqual(fixtureIds.size);
    for (const fixtureId of fixtureIds) {
      expect(tasks.some((task) => task.fixtureId === fixtureId)).toBe(true);
    }
    expect(tasks[0]).toMatchObject({
      mode: 'compare_legacy_snapshot_to_project_graph',
      expectedFiles: expect.any(Array),
      avoidFiles: expect.any(Array),
    });
    expect(tasks[0].legacyPrompt).toContain('project snapshot');
    expect(tasks[0].graphPrompt).toContain('project graph');
  });

  it('summarizes task success, files opened, wrong edits, and time-to-answer metrics', () => {
    const task = listProjectGraphEvaluationTasks()[0];
    const summary = summarizeProjectGraphEvaluationRuns([task], [
      {
        taskId: task.id,
        mode: 'legacy_snapshot',
        success: false,
        filesOpened: [...task.expectedFiles, ...task.avoidFiles],
        elapsedMs: 120000,
      },
      {
        taskId: task.id,
        mode: 'project_graph',
        success: true,
        filesOpened: task.expectedFiles,
        elapsedMs: 45000,
      },
    ]);

    expect(summary.totalRuns).toBe(2);
    expect(summary.byMode.legacy_snapshot).toMatchObject({
      runs: 1,
      successRate: 0,
      averageFilesOpened: task.expectedFiles.length + task.avoidFiles.length,
      wrongFilesOpened: task.avoidFiles.length,
      averageTimeToAnswerMs: 120000,
    });
    expect(summary.byMode.project_graph).toMatchObject({
      runs: 1,
      successRate: 1,
      averageFilesOpened: task.expectedFiles.length,
      wrongFilesOpened: 0,
      averageTimeToAnswerMs: 45000,
    });
    expect(summary.comparison).toEqual({
      successRateDelta: 1,
      averageFilesOpenedDelta: -task.avoidFiles.length,
      wrongFilesOpenedDelta: -task.avoidFiles.length,
      averageTimeToAnswerMsDelta: -75000,
    });
  });
});
