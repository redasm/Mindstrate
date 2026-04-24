import { HighOrderCompressor } from '../context-graph/high-order-compressor.js';
import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import type { CompressionStageResult, MetabolismStageOptions } from './metabolism-engine.js';

export class MetabolicCompressor {
  constructor(private readonly deps: {
    summaryCompressor: SummaryCompressor;
    patternCompressor: PatternCompressor;
    ruleCompressor: RuleCompressor;
    highOrderCompressor?: HighOrderCompressor;
  }) {}

  async run(options: MetabolismStageOptions = {}): Promise<CompressionStageResult> {
    const summary = await this.deps.summaryCompressor.compressProjectSnapshots({
      project: options.project,
      similarityThreshold: 0.6,
    });
    const pattern = await this.deps.patternCompressor.compressProjectSummaries({
      project: options.project,
      similarityThreshold: 0.6,
    });
    const rule = await this.deps.ruleCompressor.compressProjectPatterns({
      project: options.project,
      similarityThreshold: 0.75,
    });
    const highOrder = this.deps.highOrderCompressor
      ? {
        skill: await this.deps.highOrderCompressor.compressRulesToSkills({
          project: options.project,
          similarityThreshold: 0.75,
        }),
        heuristic: await this.deps.highOrderCompressor.compressSkillsToHeuristics({
          project: options.project,
          similarityThreshold: 0.75,
        }),
        axiom: await this.deps.highOrderCompressor.compressHeuristicsToAxioms({
          project: options.project,
          similarityThreshold: 0.75,
        }),
      }
      : undefined;

    return { summary, pattern, rule, highOrder };
  }
}
