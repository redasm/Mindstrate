import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import type { CompressionStageResult, MetabolismStageOptions } from './metabolism-engine.js';

export class MetabolicCompressor {
  constructor(private readonly deps: {
    summaryCompressor: SummaryCompressor;
    patternCompressor: PatternCompressor;
    ruleCompressor: RuleCompressor;
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

    return { summary, pattern, rule };
  }
}
