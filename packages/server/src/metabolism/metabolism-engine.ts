import {
  ContextDomainType,
  ContextNodeStatus,
  ContextRelationType,
  MetabolismStage,
  MetabolismRunStatus,
  SubstrateType,
  type MetabolismRun,
  type MetabolismStageStats,
  type ContextNode,
} from '@mindstrate/protocol/models';
import type { ContextGraphStore } from '../context-graph/context-graph-store.js';
import { SummaryCompressor } from '../context-graph/summary-compressor.js';
import { PatternCompressor } from '../context-graph/pattern-compressor.js';
import { RuleCompressor } from '../context-graph/rule-compressor.js';
import { ConflictDetector } from '../context-graph/conflict-detector.js';
import { ConflictReflector } from '../context-graph/conflict-reflector.js';
import { KnowledgeProjectionMaterializer } from '../projections/knowledge-projection.js';
import { Pruner } from './pruner.js';

export interface RunMetabolismOptions {
  project?: string;
  trigger?: MetabolismRun['trigger'];
}

function groupEpisodesBySource(episodes: ContextNode[]): Map<string, ContextNode[]> {
  const groups = new Map<string, ContextNode[]>();
  for (const episode of episodes) {
    const sourceRef = episode.sourceRef ?? episode.metadata?.['sessionId'];
    if (typeof sourceRef !== 'string' || sourceRef.length === 0) continue;
    const current = groups.get(sourceRef) ?? [];
    current.push(episode);
    groups.set(sourceRef, current);
  }
  return groups;
}

export interface MetabolismStageOptions {
  project?: string;
}

export interface CompressionStageResult {
  summary: Awaited<ReturnType<SummaryCompressor['compressProjectSnapshots']>>;
  pattern: Awaited<ReturnType<PatternCompressor['compressProjectSummaries']>>;
  rule: Awaited<ReturnType<RuleCompressor['compressProjectPatterns']>>;
}

export class MetabolismEngine {
  private readonly graphStore: ContextGraphStore;
  private readonly summaryCompressor: SummaryCompressor;
  private readonly patternCompressor: PatternCompressor;
  private readonly ruleCompressor: RuleCompressor;
  private readonly conflictDetector: ConflictDetector;
  private readonly conflictReflector: ConflictReflector;
  private readonly projectionMaterializer: KnowledgeProjectionMaterializer;
  private readonly pruner: Pruner;

  constructor(deps: {
    graphStore: ContextGraphStore;
    summaryCompressor: SummaryCompressor;
    patternCompressor: PatternCompressor;
    ruleCompressor: RuleCompressor;
    conflictDetector: ConflictDetector;
    conflictReflector: ConflictReflector;
    projectionMaterializer: KnowledgeProjectionMaterializer;
    pruner: Pruner;
  }) {
    this.graphStore = deps.graphStore;
    this.summaryCompressor = deps.summaryCompressor;
    this.patternCompressor = deps.patternCompressor;
    this.ruleCompressor = deps.ruleCompressor;
    this.conflictDetector = deps.conflictDetector;
    this.conflictReflector = deps.conflictReflector;
    this.projectionMaterializer = deps.projectionMaterializer;
    this.pruner = deps.pruner;
  }

  runDigest(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.DIGEST } {
    const events = this.graphStore.listEvents({
      project: options.project,
      limit: 1000,
    });
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });

    return {
      stage: MetabolismStage.DIGEST,
      scanned: events.length,
      created: episodes.length,
      updated: 0,
      skipped: Math.max(events.length - episodes.length, 0),
    };
  }

  runAssimilation(options: MetabolismStageOptions = {}): MetabolismStageStats & { stage: MetabolismStage.ASSIMILATE } {
    const episodes = this.graphStore.listNodes({
      project: options.project,
      substrateType: SubstrateType.EPISODE,
      limit: 1000,
    });
    const groups = groupEpisodesBySource(episodes);
    let created = 0;
    let skipped = 0;

    for (const [sourceRef, sourceEpisodes] of groups) {
      const existing = this.graphStore.listNodes({
        project: options.project,
        substrateType: SubstrateType.SNAPSHOT,
        sourceRef,
        limit: 1,
      })[0];
      if (existing) {
        skipped += sourceEpisodes.length;
        continue;
      }

      const snapshot = this.graphStore.createNode({
        substrateType: SubstrateType.SNAPSHOT,
        domainType: ContextDomainType.SESSION_SUMMARY,
        title: `Assimilated snapshot: ${sourceRef}`,
        content: sourceEpisodes.map((episode) => episode.content).join('\n\n'),
        tags: ['assimilated-snapshot'],
        project: options.project ?? sourceEpisodes[0]?.project,
        compressionLevel: 0.2,
        confidence: 0.75,
        qualityScore: 60,
        status: ContextNodeStatus.ACTIVE,
        sourceRef,
        metadata: {
          episodeIds: sourceEpisodes.map((episode) => episode.id),
        },
      });

      for (const episode of sourceEpisodes) {
        this.graphStore.createEdge({
          sourceId: episode.id,
          targetId: snapshot.id,
          relationType: ContextRelationType.DERIVED_FROM,
          strength: 1,
          evidence: { sourceRef },
        });
      }
      created++;
    }

    return {
      stage: MetabolismStage.ASSIMILATE,
      scanned: episodes.length,
      created,
      updated: 0,
      skipped,
    };
  }

  async runCompression(options: MetabolismStageOptions = {}): Promise<CompressionStageResult> {
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

    return { summary, pattern, rule };
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
    const { summary, pattern, rule } = await this.runCompression(options);
    const conflicts = await this.conflictDetector.detectConflicts({
      project: options.project,
    });
    const reflection = this.conflictReflector.reflectConflicts({
      project: options.project,
    });
    const prune = this.pruner.prune({
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
        [MetabolismStage.DIGEST]: digestStats,
        [MetabolismStage.ASSIMILATE]: assimilateStats,
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
        `conflictsDetected=${conflicts.conflictsDetected}`,
        `reflectionCandidates=${reflection.candidateNodesCreated}`,
        `archivedNodes=${prune.archivedNodes}`,
        `deprecatedNodes=${prune.deprecatedNodes}`,
        `projectionRecords=${projections.length}`,
      ],
    })!;
  }
}
