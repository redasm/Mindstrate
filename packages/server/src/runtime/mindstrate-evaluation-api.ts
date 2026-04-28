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
}

