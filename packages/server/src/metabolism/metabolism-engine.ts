import {
  MetabolismRunStatus,
  MetabolismStage,
  type MetabolismRun,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { ConflictDetector } from '../context-graph/conflict-detector.js';
import { ConflictReflector } from '../context-graph/conflict-reflector.js';
import { KnowledgeProjectionMaterializer } from '../projections/knowledge-projection.js';

export interface RunMetabolismOptions {
  project?: string;
  trigger?: MetabolismRun['trigger'];
}

export class MetabolismEngine {
  private readonly graphStore: ContextGraphStore;
  private readonly summaryCompressor: SummaryCompressor;
  private readonly patternCompressor: PatternCompressor;
  private readonly ruleCompressor: RuleCompressor;
  private readonly conflictDetector: ConflictDetector;
  private readonly conflictReflector: ConflictReflector;
  private readonly projectionMaterializer: KnowledgeProjectionMaterializer;

  constructor(deps: {
    graphStore: ContextGraphStore;
    summaryCompressor: SummaryCompressor;
    patternCompressor: PatternCompressor;
    ruleCompressor: RuleCompressor;
    conflictDetector: ConflictDetector;
    conflictReflector: ConflictReflector;
    projectionMaterializer: KnowledgeProjectionMaterializer;
  }) {
    this.graphStore = deps.graphStore;
    this.summaryCompressor = deps.summaryCompressor;
    this.patternCompressor = deps.patternCompressor;
    this.ruleCompressor = deps.ruleCompressor;
    this.conflictDetector = deps.conflictDetector;
    this.conflictReflector = deps.conflictReflector;
    this.projectionMaterializer = deps.projectionMaterializer;
  }

  async run(options: RunMetabolismOptions = {}): Promise<MetabolismRun> {
    const run = this.graphStore.createMetabolismRun({
      project: options.project,
      trigger: options.trigger ?? 'manual',
      status: MetabolismRunStatus.RUNNING,
      stageStats: {},
      notes: [],
    });

    const summary = await this.summaryCompressor.compressProjectSnapshots({
      project: options.project,
      similarityThreshold: 0.6,
    });
    const pattern = await this.patternCompressor.compressProjectSummaries({
      project: options.project,
      similarityThreshold: 0.6,
    });
    const rule = await this.ruleCompressor.compressProjectPatterns({
      project: options.project,
      similarityThreshold: 0.75,
    });
    const conflicts = await this.conflictDetector.detectConflicts({
      project: options.project,
    });
    const reflection = this.conflictReflector.reflectConflicts({
      project: options.project,
    });
    const projections = this.projectionMaterializer.materialize({
      project: options.project,
      limit: 50,
    });

    return this.graphStore.updateMetabolismRun(run.id, {
      status: MetabolismRunStatus.COMPLETED,
      endedAt: new Date().toISOString(),
      stageStats: {
        [MetabolismStage.COMPRESS]: {
          scanned: summary.scannedSnapshots + pattern.scannedSummaries + rule.scannedPatterns,
          created: summary.summaryNodesCreated + pattern.patternNodesCreated + rule.ruleNodesCreated,
          updated: 0,
          skipped: 0,
        },
        [MetabolismStage.REFLECT]: {
          scanned: conflicts.scannedNodes,
          created: reflection.candidateNodesCreated,
          updated: conflicts.conflictsDetected,
          skipped: 0,
        },
        [MetabolismStage.PRUNE]: {
          scanned: projections.length,
          created: projections.length,
          updated: 0,
          skipped: 0,
        },
      },
      notes: [
        `summaryNodesCreated=${summary.summaryNodesCreated}`,
        `patternNodesCreated=${pattern.patternNodesCreated}`,
        `ruleNodesCreated=${rule.ruleNodesCreated}`,
        `conflictsDetected=${conflicts.conflictsDetected}`,
        `reflectionCandidates=${reflection.candidateNodesCreated}`,
        `projectionRecords=${projections.length}`,
      ],
    })!;
  }
}
