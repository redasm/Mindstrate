import {
  listProjectGraphEvaluationFixtures,
  listProjectGraphEvaluationTasks,
  materializeProjectGraphEvaluationFixture,
  renderProjectGraphEvaluationDatasetMarkdown,
  type ProjectGraphEvaluationFixture,
  type ProjectGraphEvaluationFixtureId,
  type ProjectGraphEvaluationTask,
  type RenderProjectGraphEvaluationDatasetInput,
} from '../project-graph/index.js';
import type { EvalRunResult } from '../quality/eval.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateEvaluationApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {}

  async runEvaluation(topK?: number): Promise<EvalRunResult> {
    await this.ensureInit();
    return this.services.evaluator.runEvaluation(topK);
  }

  addEvalCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
  }) {
    return this.services.evaluator.addCase(query, expectedIds, options);
  }

  getEvalTrend(limit?: number) {
    return this.services.evaluator.getTrend(limit);
  }

  /** List the canonical project graph evaluation fixtures bundled with the server. */
  listProjectGraphFixtures(): ProjectGraphEvaluationFixture[] {
    return listProjectGraphEvaluationFixtures();
  }

  /** List the canonical project graph evaluation tasks bundled with the server. */
  listProjectGraphTasks(): ProjectGraphEvaluationTask[] {
    return listProjectGraphEvaluationTasks();
  }

  /** Materialize a fixture's source files under the given directory. */
  materializeProjectGraphFixture(fixtureId: ProjectGraphEvaluationFixtureId, destinationDir: string): void {
    materializeProjectGraphEvaluationFixture(fixtureId, destinationDir);
  }

  /** Render the project graph evaluation dataset (fixtures + tasks) as Markdown. */
  renderProjectGraphDatasetMarkdown(input: RenderProjectGraphEvaluationDatasetInput): string {
    return renderProjectGraphEvaluationDatasetMarkdown(input);
  }
}
