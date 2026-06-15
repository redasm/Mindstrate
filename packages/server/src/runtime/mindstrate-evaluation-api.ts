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
import type { EvalRunResult, EvalCaseKind } from '../quality/eval.js';
import type {
  SkillEvolutionEvaluation,
  SkillEvolutionEvaluator,
  SkillEvolutionMetric,
} from '@mindstrate/protocol/models';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateEvaluationApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
  ) {}

  async runEvaluation(topK?: number, options?: { kind?: EvalCaseKind }): Promise<EvalRunResult> {
    await this.ensureInit();
    return this.services.evaluator.runEvaluation(topK, options);
  }

  addEvalCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
    kind?: EvalCaseKind;
  }) {
    return this.services.evaluator.addCase(query, expectedIds, options);
  }

  listEvalCases(options?: { kind?: EvalCaseKind }) {
    return this.services.evaluator.listCases(options);
  }

  deleteEvalCase(id: string): boolean {
    return this.services.evaluator.deleteCase(id);
  }

  getEvalTrend(limit?: number) {
    return this.services.evaluator.getTrend(limit);
  }

  evaluateSkillPatchScoreGate(input: {
    patchId: string;
    evaluator: SkillEvolutionEvaluator;
    metric: SkillEvolutionMetric;
    baselineScore: number;
    candidateScore: number;
    details?: unknown;
  }): SkillEvolutionEvaluation {
    return this.services.skillEvolutionGate.evaluateScoreGate(input);
  }

  /**
   * Validation-gated skill patch evaluation. Runs the retrieval
   * evaluator over the held-out eval cases. When there are no eval cases
   * the gate returns `insufficient_data` and the candidate is left
   * untouched — it is never auto-accepted without evidence.
   *
   * `topK` and explicit `baselineScore` / `candidateScore` overrides are
   * supported for callers that compute scores out-of-band; otherwise the
   * current retrieval F1 is used as both scores and the gate falls back
   * to the score comparison only when eval cases exist.
   */
  async evaluateSkillPatchWithEvaluator(input: {
    patchId: string;
    evaluator: SkillEvolutionEvaluator;
    metric: SkillEvolutionMetric;
    topK?: number;
    baselineScore?: number;
    candidateScore?: number;
    details?: unknown;
  }): Promise<SkillEvolutionEvaluation> {
    await this.ensureInit();
    const run = await this.services.evaluator.runEvaluation(input.topK);
    return this.services.skillEvolutionGate.evaluateWithEvaluator(
      {
        patchId: input.patchId,
        evaluator: input.evaluator,
        metric: input.metric,
        details: input.details,
      },
      () => ({
        totalCases: run.totalCases,
        baselineScore: input.baselineScore ?? run.f1,
        candidateScore: input.candidateScore ?? run.f1,
      }),
    );
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
