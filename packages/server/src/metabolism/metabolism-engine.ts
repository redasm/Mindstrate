import {
  MetabolismStage,
  MetabolismRunStatus,
  type MetabolismRun,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { HighOrderCompressor, type HighOrderCompressionResult } from '../context-graph/high-order-compressor.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { ConflictDetector } from '../context-graph/conflict-detector.js';
import { ConflictReflector } from '../context-graph/conflict-reflector.js';
import { KnowledgeProjectionMaterializer } from '../projections/knowledge-projection.js';
import type {
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from '../projections/index.js';
import { Assimilator } from './assimilator.js';
import { DigestEngine } from './digest-engine.js';
import { MetabolicCompressor } from './compressor.js';
import { Pruner } from './pruner.js';
import { Reflector } from './reflector.js';

export interface RunMetabolismOptions {
  project?: string;
  trigger?: MetabolismRun['trigger'];
}

export interface MetabolismStageOptions {
  project?: string;
}

export interface CompressionStageResult {
  summary: Awaited<ReturnType<SummaryCompressor['compressProjectSnapshots']>>;
  pattern: Awaited<ReturnType<PatternCompressor['compressProjectSummaries']>>;
  rule: Awaited<ReturnType<RuleCompressor['compressProjectPatterns']>>;
  highOrder?: {
    skill: HighOrderCompressionResult;
    heuristic: HighOrderCompressionResult;
    axiom: HighOrderCompressionResult;
  };
}

export class MetabolismEngine {
  private readonly graphStore: ContextGraphStore;
  private readonly summaryCompressor: SummaryCompressor;
  private readonly patternCompressor: PatternCompressor;
  private readonly ruleCompressor: RuleCompressor;
  private readonly highOrderCompressor?: HighOrderCompressor;
  private readonly conflictDetector: ConflictDetector;
  private readonly conflictReflector: ConflictReflector;
  private readonly projectionMaterializer: KnowledgeProjectionMaterializer;
  private readonly sessionProjectionMaterializer?: SessionProjectionMaterializer;
  private readonly projectSnapshotProjectionMaterializer?: ProjectSnapshotProjectionMaterializer;
  private readonly obsidianProjectionMaterializer?: ObsidianProjectionMaterializer;
  private readonly pruner: Pruner;
  private readonly digestEngine: DigestEngine;
  private readonly assimilator: Assimilator;
  private readonly compressor: MetabolicCompressor;
  private readonly reflector: Reflector;

  constructor(deps: {
    graphStore: ContextGraphStore;
    summaryCompressor: SummaryCompressor;
    patternCompressor: PatternCompressor;
    ruleCompressor: RuleCompressor;
    highOrderCompressor?: HighOrderCompressor;
    conflictDetector: ConflictDetector;
    conflictReflector: ConflictReflector;
    projectionMaterializer: KnowledgeProjectionMaterializer;
    sessionProjectionMaterializer?: SessionProjectionMaterializer;
    projectSnapshotProjectionMaterializer?: ProjectSnapshotProjectionMaterializer;
    obsidianProjectionMaterializer?: ObsidianProjectionMaterializer;
    pruner: Pruner;
  }) {
    this.graphStore = deps.graphStore;
    this.summaryCompressor = deps.summaryCompressor;
    this.patternCompressor = deps.patternCompressor;
    this.ruleCompressor = deps.ruleCompressor;
    this.highOrderCompressor = deps.highOrderCompressor;
    this.conflictDetector = deps.conflictDetector;
    this.conflictReflector = deps.conflictReflector;
    this.projectionMaterializer = deps.projectionMaterializer;
    this.sessionProjectionMaterializer = deps.sessionProjectionMaterializer;
    this.projectSnapshotProjectionMaterializer = deps.projectSnapshotProjectionMaterializer;
    this.obsidianProjectionMaterializer = deps.obsidianProjectionMaterializer;
    this.pruner = deps.pruner;
    this.digestEngine = new DigestEngine(this.graphStore);
    this.assimilator = new Assimilator(this.graphStore);
    this.compressor = new MetabolicCompressor({
      summaryCompressor: this.summaryCompressor,
      patternCompressor: this.patternCompressor,
      ruleCompressor: this.ruleCompressor,
      highOrderCompressor: this.highOrderCompressor,
    });
    this.reflector = new Reflector({
      conflictDetector: this.conflictDetector,
      conflictReflector: this.conflictReflector,
    });
  }

  runDigest(options: MetabolismStageOptions = {}) {
    return this.digestEngine.run(options);
  }

  runAssimilation(options: MetabolismStageOptions = {}) {
    return this.assimilator.run(options);
  }

  async runCompression(options: MetabolismStageOptions = {}): Promise<CompressionStageResult> {
    return this.compressor.run(options);
  }

  async run(options: RunMetabolismOptions = {}): Promise<MetabolismRun> {
    const run = this.graphStore.createMetabolismRun({
      project: options.project,
      trigger: options.trigger ?? 'manual',
      status: MetabolismRunStatus.RUNNING,
      stageStats: {},
      notes: [],
    });

    const digest = this.runDigest(options);
    const assimilate = this.runAssimilation(options);
    const { stage: _digestStage, ...digestStats } = digest;
    const { stage: _assimilateStage, ...assimilateStats } = assimilate;
    const { summary, pattern, rule, highOrder } = await this.runCompression(options);
    const reflection = await this.reflector.run(options);
    const prune = this.pruner.prune({
      project: options.project,
    });
    const projections = [
      ...this.projectionMaterializer.materialize({
        project: options.project,
        limit: 50,
      }),
      ...(this.sessionProjectionMaterializer?.materialize({
        project: options.project,
        limit: 50,
      }) ?? []),
      ...(this.projectSnapshotProjectionMaterializer?.materialize({
        project: options.project,
        limit: 50,
      }) ?? []),
      ...(this.obsidianProjectionMaterializer?.materialize({
        project: options.project,
        limit: 50,
      }) ?? []),
    ];

    return this.graphStore.updateMetabolismRun(run.id, {
      status: MetabolismRunStatus.COMPLETED,
      endedAt: new Date().toISOString(),
      stageStats: {
        [MetabolismStage.DIGEST]: digestStats,
        [MetabolismStage.ASSIMILATE]: assimilateStats,
        [MetabolismStage.COMPRESS]: {
          scanned: summary.scannedSnapshots + pattern.scannedSummaries + rule.scannedPatterns
            + (highOrder?.skill.scannedNodes ?? 0)
            + (highOrder?.heuristic.scannedNodes ?? 0)
            + (highOrder?.axiom.scannedNodes ?? 0),
          created: summary.summaryNodesCreated + pattern.patternNodesCreated + rule.ruleNodesCreated
            + (highOrder?.skill.nodesCreated ?? 0)
            + (highOrder?.heuristic.nodesCreated ?? 0)
            + (highOrder?.axiom.nodesCreated ?? 0),
          updated: 0,
          skipped: 0,
        },
        [MetabolismStage.REFLECT]: {
          scanned: reflection.scanned,
          created: reflection.created,
          updated: reflection.updated,
          skipped: reflection.skipped,
        },
        [MetabolismStage.PRUNE]: {
          scanned: prune.scannedNodes,
          created: prune.archivedNodes + prune.deprecatedNodes,
          updated: 0,
          skipped: prune.skippedConflictedNodes,
        },
      },
      notes: [
        `summaryNodesCreated=${summary.summaryNodesCreated}`,
        `patternNodesCreated=${pattern.patternNodesCreated}`,
        `ruleNodesCreated=${rule.ruleNodesCreated}`,
        `skillNodesCreated=${highOrder?.skill.nodesCreated ?? 0}`,
        `heuristicNodesCreated=${highOrder?.heuristic.nodesCreated ?? 0}`,
        `axiomNodesCreated=${highOrder?.axiom.nodesCreated ?? 0}`,
        `conflictsDetected=${reflection.conflictsDetected}`,
        `reflectionCandidates=${reflection.candidateNodesCreated}`,
        `archivedNodes=${prune.archivedNodes}`,
        `deprecatedNodes=${prune.deprecatedNodes}`,
        `projectionRecords=${projections.length}`,
      ],
    })!;
  }
}
