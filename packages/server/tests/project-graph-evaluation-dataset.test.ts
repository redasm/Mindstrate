import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { ContextDomainType } from '@mindstrate/protocol/models';
import { Mindstrate, detectProject } from '../src/index.js';
import {
  evaluateProjectGraphFixture,
  listProjectGraphEvaluationFixtures,
  materializeProjectGraphEvaluationFixture,
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
});
