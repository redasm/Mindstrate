/**
 * Mindstrate - Main Entry (Facade)
 *
 * Mindstrate 主类，统一封装所有子模块，
 * 提供简洁的 API 供 CLI 和 MCP Server 使用。
 *
 * 新增能力：
 * - 自动反馈闭环（FeedbackLoop）
 * - 知识自动进化（KnowledgeEvolution）
 * - 上下文策划（Retriever.curateContext）
 * - 检索质量评估（RetrievalEvaluator）
 * - 质量门禁（Pipeline.qualityGate）
 */

import * as fs from 'node:fs';
import { loadConfig, type MindstrateConfig } from './config.js';
import type {
  CreateKnowledgeInput,
  UpdateKnowledgeInput,
  RetrievalContext,
  RetrievalFilter,
  RetrievalResult,
  KnowledgeUnit,
  AssembledContext,
  FeedbackEvent,
  GraphKnowledgeView,
} from '@mindstrate/protocol';
import { CaptureSource, KnowledgeStatus, KnowledgeType } from '@mindstrate/protocol';
import type {
  Session,
  CreateSessionInput,
  SaveObservationInput,
  CompressSessionInput,
  SessionContext,
} from '@mindstrate/protocol';
import { MetadataStore } from './storage/metadata-store.js';
import { VectorStore } from './storage/vector-store.js';
import type { IVectorStore } from './storage/vector-store-interface.js';
import { SessionStore } from './storage/session-store.js';
import { Embedder } from './processing/embedder.js';
import { Pipeline, type PipelineResult, type QualityGateResult } from './processing/pipeline.js';
import { SessionCompressor } from './processing/session-compressor.js';
import { Retriever } from './retrieval/retriever.js';
import { QualityScorer } from './quality/scorer.js';
import { FeedbackLoop } from './quality/feedback-loop.js';
import { KnowledgeEvolution, type EvolutionSuggestion, type EvolutionRunResult } from './quality/evolution.js';
import { RetrievalEvaluator, type EvalRunResult } from './quality/eval.js';
import {
  buildProjectSnapshot,
  type DetectedProject,
} from './project/index.js';
import { runContextAssemblyDag } from './context-graph/context-assembly-dag.js';
import { ContextInternalizer, type InternalizationSuggestionOptions, type InternalizationSuggestions } from './context-graph/context-internalizer.js';
import { ContextPrioritySelector } from './context-graph/context-priority-selector.js';
import { ContextGraphStore } from './context-graph/context-graph-store.js';
import { GraphKnowledgeProjector, toGraphKnowledgeView, type GraphKnowledgeProjectionOptions } from './context-graph/knowledge-projector.js';
import { ProjectedKnowledgeSearch, type ProjectedKnowledgeSearchOptions } from './context-graph/projected-knowledge-search.js';
import { ConflictDetector, type ConflictDetectionOptions, type ConflictDetectionResult } from './context-graph/conflict-detector.js';
import {
  ConflictReflector,
  type AcceptReflectionCandidateResult,
  type ConflictReflectionOptions,
  type ConflictReflectionResult,
  type RejectReflectionCandidateResult,
} from './context-graph/conflict-reflector.js';
import { digestCompletedSession, digestSessionObservation } from './context-graph/session-digest.js';
import { PatternCompressor, type PatternCompressionOptions, type PatternCompressionResult } from './context-graph/pattern-compressor.js';
import { RuleCompressor, type RuleCompressionOptions, type RuleCompressionResult } from './context-graph/rule-compressor.js';
import { SummaryCompressor, type SummaryCompressionOptions, type SummaryCompressionResult } from './context-graph/summary-compressor.js';
import { HighOrderCompressor } from './context-graph/high-order-compressor.js';
import {
  MetabolismEngine,
  MetabolismScheduler,
  Pruner,
  type MetabolismSchedulerOptions,
  type RunMetabolismOptions,
  type PruneOptions,
  type PruneResult,
} from './metabolism/index.js';
import {
  KnowledgeProjectionMaterializer,
  KnowledgeUnitMaterializer,
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from './projections/index.js';
import { ContextDomainType, SubstrateType } from '@mindstrate/protocol/models';
import type {
  ConflictRecord,
  ContextEdge,
  ContextEvent,
  ContextNode,
  ContextNodeStatus,
  CuratedContext,
  MetabolismRun,
  ProjectionRecord,
} from '@mindstrate/protocol/models';
import type { UpdateContextNodeInput } from './context-graph/context-graph-store.js';
import { digestKnowledgeInput } from './context-graph/knowledge-digest.js';
import {
  ingestContextEvent,
  ingestGitActivity,
  ingestLspDiagnostic,
  ingestKnowledgeWrite,
  ingestProjectSnapshotEvent,
  ingestTestRun,
  ingestUserFeedback,
  type IngestContextEventInput,
} from './events/index.js';
import { PortableContextBundleManager, type CreateBundleOptions, type EditableBundleFiles, type InstallBundleFromRegistryOptions, type InstallBundleResult, type PublishBundleOptions, type PublishBundleResult, type ValidateBundleResult } from './bundles/index.js';

/**
 * Optional sink invoked whenever a knowledge mutation is committed by the facade.
 * Used by external integrations (e.g. obsidian-sync) to mirror state without
 * coupling core to those packages.
 */
export interface KnowledgeMutationSink {
  onAdded?(knowledge: KnowledgeUnit): void | Promise<void>;
  onUpdated?(knowledge: KnowledgeUnit): void | Promise<void>;
  onDeleted?(id: string): void | Promise<void>;
}

export class Mindstrate {
  private config: MindstrateConfig;
  private metadataStore: MetadataStore;
  private contextGraphStore: ContextGraphStore;
  private contextInternalizer: ContextInternalizer;
  private contextPrioritySelector: ContextPrioritySelector;
  private graphKnowledgeProjector: GraphKnowledgeProjector;
  private projectedKnowledgeSearch: ProjectedKnowledgeSearch;
  private projectionMaterializer: KnowledgeProjectionMaterializer;
  private sessionProjectionMaterializer: SessionProjectionMaterializer;
  private projectSnapshotProjectionMaterializer: ProjectSnapshotProjectionMaterializer;
  private obsidianProjectionMaterializer: ObsidianProjectionMaterializer;
  private knowledgeUnitMaterializer: KnowledgeUnitMaterializer;
  private metabolismEngine: MetabolismEngine;
  private pruner: Pruner;
  private conflictDetector: ConflictDetector;
  private conflictReflector: ConflictReflector;
  private patternCompressor: PatternCompressor;
  private ruleCompressor: RuleCompressor;
  private summaryCompressor: SummaryCompressor;
  private highOrderCompressor: HighOrderCompressor;
  private vectorStore: IVectorStore;
  private sessionStore: SessionStore;
  private embedder: Embedder;
  private pipeline: Pipeline;
  private sessionCompressor: SessionCompressor;
  private retriever: Retriever;
  private bundleManager: PortableContextBundleManager;
  private scorer: QualityScorer;
  private feedbackLoop: FeedbackLoop;
  private evolution: KnowledgeEvolution;
  private evaluator: RetrievalEvaluator;
  private metabolismScheduler: MetabolismScheduler | null = null;
  private mutationSinks: KnowledgeMutationSink[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(configOverrides?: Partial<MindstrateConfig> & {
    /** Custom vector store implementation (default: local JSON-based VectorStore) */
    vectorStore?: IVectorStore;
  }) {
    this.config = loadConfig(configOverrides);

    // 确保数据目录存在
    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }

    // OpenAI-compatible client config (defaults to official OpenAI; set
    // openaiBaseUrl in env/config to use Aliyun, DeepSeek, Moonshot, etc.)
    const llmBaseUrl = this.config.openaiBaseUrl;
    const embeddingBaseUrl = this.config.openaiEmbeddingBaseUrl ?? llmBaseUrl;

    // 初始化各模块
    this.metadataStore = new MetadataStore(this.config.dbPath);
    this.contextGraphStore = new ContextGraphStore(this.metadataStore.getDb());
    this.contextInternalizer = new ContextInternalizer(this.contextGraphStore);
    this.contextPrioritySelector = new ContextPrioritySelector(this.contextGraphStore);
    this.graphKnowledgeProjector = new GraphKnowledgeProjector(this.contextGraphStore);
    this.projectedKnowledgeSearch = new ProjectedKnowledgeSearch(this.graphKnowledgeProjector);
    this.projectionMaterializer = new KnowledgeProjectionMaterializer(this.contextGraphStore, this.graphKnowledgeProjector);
    this.sessionProjectionMaterializer = new SessionProjectionMaterializer(this.contextGraphStore);
    this.projectSnapshotProjectionMaterializer = new ProjectSnapshotProjectionMaterializer(this.contextGraphStore);
    this.obsidianProjectionMaterializer = new ObsidianProjectionMaterializer(this.contextGraphStore);
    this.embedder = new Embedder(this.config.openaiApiKey, this.config.embeddingModel, embeddingBaseUrl);
    this.conflictDetector = new ConflictDetector(this.contextGraphStore, this.embedder);
    this.conflictReflector = new ConflictReflector(this.contextGraphStore);
    this.patternCompressor = new PatternCompressor(this.contextGraphStore, this.embedder);
    this.ruleCompressor = new RuleCompressor(this.contextGraphStore, this.embedder);
    this.summaryCompressor = new SummaryCompressor(this.contextGraphStore, this.embedder);
    this.highOrderCompressor = new HighOrderCompressor(this.contextGraphStore, this.embedder);
    this.pruner = new Pruner(this.contextGraphStore);
    this.metabolismEngine = new MetabolismEngine({
      graphStore: this.contextGraphStore,
      summaryCompressor: this.summaryCompressor,
      patternCompressor: this.patternCompressor,
      ruleCompressor: this.ruleCompressor,
      highOrderCompressor: this.highOrderCompressor,
      conflictDetector: this.conflictDetector,
      conflictReflector: this.conflictReflector,
      projectionMaterializer: this.projectionMaterializer,
      sessionProjectionMaterializer: this.sessionProjectionMaterializer,
      projectSnapshotProjectionMaterializer: this.projectSnapshotProjectionMaterializer,
      obsidianProjectionMaterializer: this.obsidianProjectionMaterializer,
      pruner: this.pruner,
    });
    this.vectorStore = configOverrides?.vectorStore
      ?? new VectorStore(this.config.vectorStorePath, this.config.collectionName);
    this.knowledgeUnitMaterializer = new KnowledgeUnitMaterializer(
      this.contextGraphStore,
      this.metadataStore,
      this.vectorStore,
      this.embedder,
    );
    this.sessionStore = new SessionStore(this.metadataStore.getDb());
    this.bundleManager = new PortableContextBundleManager(this.contextGraphStore);
    this.sessionCompressor = new SessionCompressor(this.config.openaiApiKey, this.config.llmModel, llmBaseUrl);

    // 自动反馈闭环
    this.feedbackLoop = new FeedbackLoop(this.metadataStore.getDb(), this.metadataStore);

    // Pipeline 和 Retriever 使用 FeedbackLoop
    this.pipeline = new Pipeline(
      this.metadataStore,
      this.vectorStore,
      this.embedder,
      this.config.deduplicationThreshold,
    );
    this.retriever = new Retriever(
      this.metadataStore,
      this.vectorStore,
      this.embedder,
      this.feedbackLoop,
    );
    this.scorer = new QualityScorer(this.metadataStore, this.feedbackLoop);

    // 知识进化引擎
    this.evolution = new KnowledgeEvolution(
      this.metadataStore,
      this.vectorStore,
      this.embedder,
      this.feedbackLoop,
      this.config.openaiApiKey,
      { baseURL: llmBaseUrl, llmModel: this.config.llmModel },
    );

    // 检索评估
    this.evaluator = new RetrievalEvaluator(this.metadataStore.getDb(), this.retriever);
  }

  /** 异步初始化（必须在使用前调用，并发安全） */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.vectorStore.initialize().then(() => {
        this.initialized = true;
      }).catch((err) => {
        // 重置以允许重试
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  // ============================================================
  // 知识写入
  // ============================================================

  /** 添加一条新知识 */
  async add(input: CreateKnowledgeInput): Promise<PipelineResult> {
    await this.ensureInit();
    const gateResult = this.pipeline.qualityGate(input);
    if (!gateResult.passed) {
      return {
        success: false,
        message: `Quality gate failed: ${gateResult.errors.join('; ')}`,
        qualityWarnings: gateResult.warnings,
      };
    }

    const exactDuplicate = this.metadataStore.findExactDuplicate(input);
    if (exactDuplicate) {
      this.metadataStore.recordUsage(exactDuplicate.id);
      return {
        success: false,
        message: `Exact duplicate detected. Existing knowledge ID: ${exactDuplicate.id}`,
        duplicateOf: exactDuplicate.id,
      };
    }

    const digested = digestKnowledgeInput(input, {
      completenessScore: gateResult.completenessScore,
    });
    const text = `${digested.nodeInput.title}\n${digested.nodeInput.content}`;
    const embedding = await this.embedder.embed(text);
    const duplicates = await this.vectorStore.findDuplicates(
      embedding,
      this.getConfig().deduplicationThreshold,
    );

    if (duplicates.length > 0) {
      const dup = duplicates[0];
      this.metadataStore.recordUsage(dup.id);
      return {
        success: false,
        message: `Duplicate detected (similarity: ${(dup.score * 100).toFixed(1)}%). Existing knowledge ID: ${dup.id}`,
        duplicateOf: dup.id,
      };
    }

    const node = this.contextGraphStore.createNode(digested.nodeInput);
    const { knowledge } = await this.knowledgeUnitMaterializer.materializeNode(node);
    this.tryIngestDerivedEvent(() => ingestKnowledgeWrite(this.contextGraphStore, knowledge));
    await this.notifySinks('added', knowledge);

    return {
      success: true,
      view: toGraphKnowledgeView(node),
      message: `Context node added successfully: ${node.title}`,
      qualityWarnings: gateResult.warnings.length > 0 ? gateResult.warnings : undefined,
    };
  }

  /**
   * Idempotent upsert of a project snapshot KU.
   *
   * Behavior:
   *  - Computes a deterministic id from `project.root + project.name`.
   *  - Extracts preserve blocks from the existing KU's solution (if any).
   *  - Re-renders the snapshot body, merging preserved sections.
   *  - Inserts the KU directly (bypassing dedup / quality gate) so
   *    multiple `mindstrate init` runs always converge on the same record.
   *  - Returns whether the body actually changed since last time.
   */
  async upsertProjectSnapshot(
    project: DetectedProject,
    options: { author?: string; trusted?: boolean } = {},
  ): Promise<{ knowledge: KnowledgeUnit; changed: boolean; created: boolean }> {
    await this.ensureInit();

    // Build with knowledge of the existing solution (so preserve blocks survive).
    const { id } = buildProjectSnapshot(project, options);
    const existing = this.metadataStore.getById(id);
    const previousSolution = existing?.solution;
    const built = buildProjectSnapshot(project, { ...options, previousSolution });

    let knowledge: KnowledgeUnit;
    let created = false;

    if (existing) {
      knowledge = this.metadataStore.update(id, {
        title: built.input.title,
        problem: built.input.problem,
        solution: built.input.solution,
        tags: built.input.tags,
        confidence: built.input.confidence,
        actionable: built.input.actionable,
        context: built.input.context,
      })!;
    } else {
      knowledge = this.metadataStore.create(built.input, { id });
      created = true;
    }

    // Re-embed and write to vector store so semantic search picks up new content.
    try {
      const text = this.embedder.knowledgeToText(knowledge);
      const embedding = await this.embedder.embed(text);
      // delete then add to handle both create and update paths uniformly
      await this.vectorStore.delete(id);
      await this.vectorStore.add({
        id,
        embedding,
        text,
        metadata: {
          type: knowledge.type,
          language: knowledge.context.language ?? '',
          framework: knowledge.context.framework ?? '',
          project: knowledge.context.project ?? '',
        },
      });
    } catch (err) {
      // Embedding failures shouldn't break init; the metadata is still queryable.
      console.warn(
        `[Mindstrate] project snapshot embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (created) {
      this.tryIngestDerivedEvent(() => ingestProjectSnapshotEvent(this.contextGraphStore, knowledge));
      this.projectSnapshotProjectionMaterializer.materialize({ project: knowledge.context.project, limit: 10 });
      await this.notifySinks('added', knowledge);
    } else if (built.changed) {
      this.tryIngestDerivedEvent(() => ingestProjectSnapshotEvent(this.contextGraphStore, knowledge));
      this.projectSnapshotProjectionMaterializer.materialize({ project: knowledge.context.project, limit: 10 });
      await this.notifySinks('updated', knowledge);
    }

    return { knowledge, changed: built.changed || created, created };
  }

  /**
   * Returns the project snapshot KU previously created by `upsertProjectSnapshot`,
   * or null if none exists.
   */
  getProjectSnapshot(project: DetectedProject): KnowledgeUnit | null {
    const { id } = buildProjectSnapshot(project);
    return this.metadataStore.getById(id);
  }

  /** 质量门禁预检查（不写入，仅检查质量） */
  checkQuality(input: CreateKnowledgeInput): QualityGateResult {
    return this.pipeline.qualityGate(input);
  }

  // ============================================================
  // 知识检索
  // ============================================================

  /** 搜索相关知识 */
  async search(
    query: string,
    options?: {
      context?: RetrievalContext;
      filter?: RetrievalFilter;
      topK?: number;
      sessionId?: string;
    },
  ): Promise<RetrievalResult[]> {
    await this.ensureInit();
    const topK = options?.topK ?? this.config.defaultTopK;
    const projected = this.queryGraphKnowledge(query, {
      project: options?.context?.project ?? options?.filter?.project,
      topK,
      limit: 50,
    });
    const projectedResults = projected.map((item) =>
      projectToRetrievalResult(item.view, item.relevanceScore, item.matchReason)
    );
    if (projectedResults.length >= topK) {
      return projectedResults.slice(0, topK);
    }

    const fallbackResults = await this.retriever.search(
      query,
      options?.context,
      options?.filter,
      topK,
      options?.sessionId,
    );

    return mergeRetrievalResults(projectedResults, fallbackResults, topK);
  }

  /**
   * 上下文策划：自动组装任务知识包
   */
  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    sessionId?: string,
  ): Promise<CuratedContext> {
    await this.ensureInit();
    const project = context?.project;
    const graphSelection = this.contextPrioritySelector.select({
      project,
      perLayerLimit: 5,
    });
    const conflicts = this.listConflictRecords(project, 5);
    const base = await this.retriever.curateContext(taskDescription, context, sessionId);

    const sections: string[] = [`## Context for: ${taskDescription}`];
    if (graphSelection.rules.length > 0) {
      sections.push('\n### Operational Rules');
      sections.push(...graphSelection.rules.map((node) => `- ${node.title}`));
    }
    if (graphSelection.patterns.length > 0) {
      sections.push('\n### Repeated Patterns');
      sections.push(...graphSelection.patterns.map((node) => `- ${node.title}`));
    }
    if (graphSelection.summaries.length > 0) {
      sections.push('\n### Recent Summary Clusters');
      sections.push(...graphSelection.summaries.map((node) => `- ${node.title}`));
    }
    if (conflicts.length > 0) {
      sections.push('\n### Active Conflicts');
      sections.push(...conflicts.map((record) => `- ${record.reason}`));
    }
    sections.push('\n### Task Curation');
    sections.push(base.summary);

    return {
      ...base,
      graphRules: graphSelection.rules.map((node) => node.title),
      graphPatterns: graphSelection.patterns.map((node) => node.title),
      graphSummaries: graphSelection.summaries.map((node) => node.title),
      graphConflicts: conflicts.map((record) => record.reason),
      summary: sections.join('\n'),
    };
  }

  async assembleContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
    },
  ): Promise<AssembledContext> {
    await this.ensureInit();
    const graphSelection = this.contextPrioritySelector.select({
      project: options?.project ?? options?.context?.project,
      perLayerLimit: 5,
    });
    const result = await runContextAssemblyDag(
      {
        taskDescription,
        project: options?.project,
        context: options?.context,
        sessionId: options?.sessionId,
      },
      {
        loadSessionContext: (project) => project ? this.formatSessionContext(project) || undefined : undefined,
        loadProjectSnapshot: (project) => project ? this.findProjectSnapshot(project) : null,
        loadGraphSummaries: () => graphSelection.summaries,
        loadGraphPatterns: () => graphSelection.patterns,
        loadGraphRules: () => graphSelection.rules,
        loadGraphConflicts: (project) => this.listConflictRecords(project, 10),
        curateContext: (task, context, sessionId) => this.curateContext(task, context, sessionId),
        formatSummary: (
          task,
          project,
          sessionContext,
          projectSnapshot,
          curated,
        ) => this.formatAssembledContext(
          task,
          project,
          sessionContext,
          projectSnapshot,
          curated,
        ),
      },
    );

    return result.assembled;
  }

  async assembleWorkingContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
    },
  ): Promise<AssembledContext> {
    return this.assembleContext(taskDescription, options);
  }

  // ============================================================
  // 知识 CRUD
  // ============================================================

  get(id: string): KnowledgeUnit | null {
    return this.metadataStore.getById(id);
  }

  /** Find knowledge by full ID or ID prefix */
  findByIdOrPrefix(idOrPrefix: string): KnowledgeUnit | null {
    // Try exact match first
    const exact = this.metadataStore.getById(idOrPrefix);
    if (exact) return exact;
    // Fallback to prefix search via SQL LIKE
    return this.metadataStore.findByIdPrefix(idOrPrefix);
  }

  update(id: string, input: UpdateKnowledgeInput): KnowledgeUnit | null {
    const updated = this.metadataStore.update(id, input);
    if (updated) {
      void this.notifySinks('updated', updated);
    }
    return updated;
  }

  async updateAndReindex(id: string, input: UpdateKnowledgeInput): Promise<KnowledgeUnit | null> {
    await this.ensureInit();

    const updated = this.metadataStore.update(id, input);
    if (!updated) return null;

    const text = this.embedder.knowledgeToText(updated);
    const embedding = await this.embedder.embed(text);
    await this.vectorStore.update({
      id: updated.id,
      embedding,
      text,
      metadata: {
        type: updated.type,
        language: updated.context.language ?? '',
        framework: updated.context.framework ?? '',
        project: updated.context.project ?? '',
      },
    });

    await this.notifySinks('updated', updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    const deleted = this.metadataStore.delete(id);
    if (deleted) {
      await this.vectorStore.delete(id);
      await this.notifySinks('deleted', id);
    }
    return deleted;
  }

  list(filter?: RetrievalFilter, limit?: number): KnowledgeUnit[] {
    return this.metadataStore.query(filter ?? {}, limit);
  }

  updateContextNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.contextGraphStore.updateNode(id, input);
  }

  deleteContextNode(id: string): boolean {
    return this.contextGraphStore.deleteNode(id);
  }

  // ============================================================
  // 知识反馈
  // ============================================================

  upvote(id: string): void {
    this.metadataStore.vote(id, 'up');
  }

  downvote(id: string): void {
    this.metadataStore.vote(id, 'down');
  }

  /**
   * 记录自动反馈（检索结果的使用情况）
   */
  recordFeedback(
    retrievalId: string,
    signal: FeedbackEvent['signal'],
    context?: string,
  ): void {
    this.feedbackLoop.recordFeedback(retrievalId, signal, context);
    this.tryIngestDerivedEvent(() => ingestUserFeedback(this.contextGraphStore, {
      retrievalId,
      signal,
      context,
    }));
  }

  /**
   * 获取知识的反馈统计
   */
  getFeedbackStats(knowledgeId: string) {
    return this.feedbackLoop.getFeedbackStats(knowledgeId);
  }

  // ============================================================
  // 知识进化
  // ============================================================

  /**
   * 运行知识进化循环
   */
  async runEvolution(options?: {
    autoApply?: boolean;
    maxItems?: number;
    mode?: 'standard' | 'background';
  }): Promise<EvolutionRunResult> {
    await this.ensureInit();
    return this.evolution.runEvolution(options);
  }

  /**
   * 应用进化建议
   */
  applyEvolutionSuggestion(suggestion: EvolutionSuggestion): boolean {
    return this.evolution.applySuggestion(suggestion);
  }

  // ============================================================
  // 检索评估
  // ============================================================

  /**
   * 运行检索质量评估
   */
  async runEvaluation(topK?: number): Promise<EvalRunResult> {
    await this.ensureInit();
    return this.evaluator.runEvaluation(topK);
  }

  /** 添加评估用例 */
  addEvalCase(query: string, expectedIds: string[], options?: {
    language?: string;
    framework?: string;
  }) {
    return this.evaluator.addCase(query, expectedIds, options);
  }

  /** 获取评估趋势 */
  getEvalTrend(limit?: number) {
    return this.evaluator.getTrend(limit);
  }

  // ============================================================
  // 会话记忆
  // ============================================================

  /** 开始新会话（自动压缩并结束同项目的旧活跃会话） */
  async startSession(input: CreateSessionInput = {}): Promise<Session> {
    // 自动结束同项目的旧活跃会话
    const active = this.sessionStore.getActiveSession(input.project);
    if (active) {
      // 自动解决该会话中未响应的反馈
      this.feedbackLoop.resolveTimeouts(active.id);
      // 自动压缩后再结束，避免丢失观察数据
      if (!active.summary && (active.observations?.length ?? 0) > 0) {
        try {
          await this.autoCompressSession(active.id);
        } catch (err) {
          // Compression is best-effort; don't block new session creation
          console.warn(
            `[Mindstrate] Failed to auto-compress session ${active.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      this.sessionStore.endSession(active.id, 'abandoned');
    }
    return this.sessionStore.create(input);
  }

  /** 保存会话观察（AI 工作过程中的关键事件） */
  saveObservation(input: SaveObservationInput): void {
    this.sessionStore.addObservation(input);

    const session = this.sessionStore.getById(input.sessionId);
    if (!session) return;

    digestSessionObservation({
      graphStore: this.contextGraphStore,
      sessionId: input.sessionId,
      project: session.project || undefined,
      observation: {
        timestamp: new Date().toISOString(),
        type: input.type,
        content: input.content,
        metadata: input.metadata,
      },
    });
  }

  ingestEvent(input: IngestContextEventInput): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestContextEvent(this.contextGraphStore, input);
  }

  ingestGitActivity(input: {
    content: string;
    project?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestGitActivity(this.contextGraphStore, input);
  }

  ingestTestRun(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestTestRun(this.contextGraphStore, input);
  }

  ingestLspDiagnostic(input: {
    content: string;
    project?: string;
    sessionId?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestLspDiagnostic(this.contextGraphStore, input);
  }

  /** 压缩当前会话（由 AI 调用，传入摘要） */
  compressSession(input: CompressSessionInput): void {
    this.sessionStore.compress(input);
  }

  /** 自动压缩会话（用 LLM 或规则从观察中生成摘要） */
  async autoCompressSession(sessionId: string): Promise<CompressSessionInput | null> {
    const session = this.sessionStore.getById(sessionId);
    if (!session) return null;

    const result = await this.sessionCompressor.compress(session);
    this.sessionStore.compress(result);
    return result;
  }

  /** 结束会话 */
  async endSession(sessionId: string): Promise<void> {
    let session = this.sessionStore.getById(sessionId);
    if (!session) return;

    // 自动解决未响应的反馈追踪
    this.feedbackLoop.resolveTimeouts(sessionId);

    // 如果没有摘要，自动压缩
    if (!session.summary && (session.observations?.length ?? 0) > 0) {
      await this.autoCompressSession(sessionId);
      session = this.sessionStore.getById(sessionId);
      if (!session) return;
    }

    this.sessionStore.endSession(sessionId, 'completed');
    const completedSession = this.sessionStore.getById(sessionId);
    if (completedSession) {
      digestCompletedSession({
        graphStore: this.contextGraphStore,
        session: completedSession,
      });
      const summaryResult = await this.summaryCompressor.compressProjectSnapshots({
        project: completedSession.project || undefined,
      });
      if (summaryResult.summaryNodesCreated > 0) {
        const patternResult = await this.patternCompressor.compressProjectSummaries({
          project: completedSession.project || undefined,
        });
        if (patternResult.patternNodesCreated > 0) {
          const ruleResult = await this.ruleCompressor.compressProjectPatterns({
            project: completedSession.project || undefined,
          });
          if (ruleResult.ruleNodesCreated > 0) {
            const conflictResult = await this.conflictDetector.detectConflicts({
              project: completedSession.project || undefined,
              substrateType: 'rule' as SubstrateType,
            });
            if (conflictResult.conflictsDetected > 0) {
              this.conflictReflector.reflectConflicts({
                project: completedSession.project || undefined,
              });
            }
          }
        }
      }
    }
  }

  /** 恢复会话上下文（新会话开始时调用） */
  restoreSessionContext(project: string = ''): SessionContext {
    const context = this.sessionStore.restoreContext(project);
    const graphSnapshots = this.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.SESSION_SUMMARY,
      limit: 5,
    });

    if (graphSnapshots.length > 0) {
      context.graphSnapshots = graphSnapshots.map((node) => ({
        nodeId: node.id,
        title: node.title,
        summary: node.content,
        endedAt: typeof node.metadata?.['endedAt'] === 'string'
          ? node.metadata['endedAt']
          : undefined,
      }));
    }

    return context;
  }

  /** 格式化会话上下文为可注入的文本 */
  formatSessionContext(project: string = ''): string {
    const ctx = this.restoreSessionContext(project);
    return this.sessionStore.formatContextForInjection(ctx);
  }

  /** 获取当前活跃会话 */
  getActiveSession(project: string = ''): Session | null {
    return this.sessionStore.getActiveSession(project);
  }

  /** 获取会话 */
  getSession(id: string): Session | null {
    return this.sessionStore.getById(id);
  }

  /** 获取最近会话列表 */
  getRecentSessions(project: string = '', limit: number = 10): Session[] {
    return this.sessionStore.getRecentSessions(project, limit);
  }

  // ============================================================
  // ECS context graph
  // ============================================================

  async runSummaryCompression(options?: SummaryCompressionOptions): Promise<SummaryCompressionResult> {
    await this.ensureInit();
    return this.summaryCompressor.compressProjectSnapshots(options);
  }

  async runPatternCompression(options?: PatternCompressionOptions): Promise<PatternCompressionResult> {
    await this.ensureInit();
    return this.patternCompressor.compressProjectSummaries(options);
  }

  async runRuleCompression(options?: RuleCompressionOptions): Promise<RuleCompressionResult> {
    await this.ensureInit();
    return this.ruleCompressor.compressProjectPatterns(options);
  }

  async runConflictDetection(options?: ConflictDetectionOptions): Promise<ConflictDetectionResult> {
    await this.ensureInit();
    return this.conflictDetector.detectConflicts(options);
  }

  runConflictReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.conflictReflector.reflectConflicts(options);
  }

  async runMetabolism(options?: RunMetabolismOptions): Promise<MetabolismRun> {
    await this.ensureInit();
    return this.metabolismEngine.run(options);
  }

  startMetabolismScheduler(options: Omit<MetabolismSchedulerOptions, 'runMetabolism'>): void {
    this.stopMetabolismScheduler();
    this.metabolismScheduler = new MetabolismScheduler({
      ...options,
      runMetabolism: (runOptions) => this.runMetabolism(runOptions),
    });
    this.metabolismScheduler.start();
  }

  stopMetabolismScheduler(): void {
    this.metabolismScheduler?.stop();
    this.metabolismScheduler = null;
  }

  runDigest(options?: { project?: string }) {
    return this.metabolismEngine.runDigest(options);
  }

  runAssimilation(options?: { project?: string }) {
    return this.metabolismEngine.runAssimilation(options);
  }

  async runCompression(options?: { project?: string }) {
    await this.ensureInit();
    return this.metabolismEngine.runCompression(options);
  }

  runPruning(options?: PruneOptions): PruneResult {
    return this.pruner.prune(options);
  }

  runReflection(options?: ConflictReflectionOptions): ConflictReflectionResult {
    return this.runConflictReflection(options);
  }

  acceptConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    resolution: string;
  }): AcceptReflectionCandidateResult {
    return this.conflictReflector.acceptCandidate(input);
  }

  rejectConflictCandidate(input: {
    conflictId: string;
    candidateNodeId: string;
    reason: string;
  }): RejectReflectionCandidateResult {
    return this.conflictReflector.rejectCandidate(input);
  }

  projectKnowledgeUnit(options?: GraphKnowledgeProjectionOptions): ProjectionRecord[] {
    return this.projectionMaterializer.materialize(options);
  }

  projectSessionSummaries(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.sessionProjectionMaterializer.materialize(options);
  }

  projectProjectSnapshots(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.projectSnapshotProjectionMaterializer.materialize(options);
  }

  projectObsidianDocuments(options?: { project?: string; limit?: number }): ProjectionRecord[] {
    return this.obsidianProjectionMaterializer.materialize(options);
  }

  writeObsidianProjectionFiles(options: { project?: string; limit?: number; rootDir: string }): string[] {
    return this.obsidianProjectionMaterializer.writeFiles(options);
  }

  importObsidianProjectionFile(filePath: string) {
    return this.obsidianProjectionMaterializer.importFile(filePath);
  }

  generateInternalizationSuggestions(options?: InternalizationSuggestionOptions): InternalizationSuggestions {
    return this.contextInternalizer.generateSuggestions(options);
  }

  listContextNodes(options?: {
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    sourceRef?: string;
    limit?: number;
  }): ContextNode[] {
    return this.contextGraphStore.listNodes(options);
  }

  listConflictRecords(project?: string, limit?: number): ConflictRecord[] {
    return this.contextGraphStore.listConflictRecords({ project, limit });
  }

  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: import('@mindstrate/protocol/models').ContextRelationType;
    limit?: number;
  }): ContextEdge[] {
    return this.contextGraphStore.listEdges(options);
  }

  queryContextGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): ContextNode[] {
    const nodes = this.contextGraphStore.listNodes({
      project: options?.project,
      substrateType: options?.substrateType,
      domainType: options?.domainType,
      status: options?.status,
      limit: Math.max(options?.limit ?? 20, 1) * 10,
    });
    const query = options?.query?.trim().toLowerCase();
    if (!query) {
      return nodes.slice(0, options?.limit ?? 20);
    }

    const tokens = query.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(Boolean);
    return nodes
      .map((node) => ({
        node,
        score: computeGraphNodeMatchScore(tokens, node),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options?.limit ?? 20)
      .map((entry) => entry.node);
  }

  listProjectionRecords(options?: { nodeId?: string; target?: string; limit?: number }): ProjectionRecord[] {
    return this.contextGraphStore.listProjectionRecords(options);
  }

  listMetabolismRuns(project?: string, limit?: number): MetabolismRun[] {
    return this.contextGraphStore.listMetabolismRuns({ project, limit });
  }

  createBundle(options: CreateBundleOptions) {
    return this.bundleManager.createBundle(options);
  }

  validateBundle(bundle: import('@mindstrate/protocol/models').PortableContextBundle): ValidateBundleResult {
    return this.bundleManager.validateBundle(bundle);
  }

  installBundle(bundle: import('@mindstrate/protocol/models').PortableContextBundle): InstallBundleResult {
    return this.bundleManager.installBundle(bundle);
  }

  installBundleFromRegistry(options: InstallBundleFromRegistryOptions): Promise<InstallBundleResult> {
    return this.bundleManager.installBundleFromRegistry(options);
  }

  publishBundle(bundle: import('@mindstrate/protocol/models').PortableContextBundle, options?: PublishBundleOptions): PublishBundleResult {
    return this.bundleManager.publishBundle(bundle, options);
  }

  createEditableBundleFiles(bundle: import('@mindstrate/protocol/models').PortableContextBundle): EditableBundleFiles {
    return this.bundleManager.createEditableBundleFiles(bundle);
  }

  readGraphKnowledge(options?: GraphKnowledgeProjectionOptions): GraphKnowledgeView[] {
    return this.graphKnowledgeProjector.project(options);
  }

  queryGraphKnowledge(query: string, options?: ProjectedKnowledgeSearchOptions) {
    return this.projectedKnowledgeSearch.search(query, options);
  }

  // ============================================================
  // 维护
  // ============================================================

  runMaintenance(): {
    total: number;
    updated: number;
    deprecated: number;
    outdated: number;
  } {
    return this.scorer.runMaintenance();
  }

  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byLanguage: Record<string, number>;
    vectorCount: number;
    feedbackStats: {
      totalEvents: number;
      last30Days: number;
      avgAdoptionRate: number;
    };
  }> {
    const dbStats = this.metadataStore.getStats();
    const vectorCount = await this.vectorStore.count();
    const feedbackStats = this.feedbackLoop.getGlobalStats();

    return {
      ...dbStats,
      vectorCount,
      feedbackStats: {
        totalEvents: feedbackStats.totalEvents,
        last30Days: feedbackStats.last30Days,
        avgAdoptionRate: feedbackStats.avgAdoptionRate,
      },
    };
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /** 关闭所有连接，确保数据持久化 */
  close(): void {
    this.stopMetabolismScheduler();
    this.vectorStore.flush();
    this.metadataStore.close();
  }

  getConfig(): Readonly<MindstrateConfig> {
    return this.config;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  private findProjectSnapshot(project: string): KnowledgeUnit | null {
    const candidates = this.metadataStore.query({
      project,
      types: [KnowledgeType.ARCHITECTURE],
    }, 20);

    return candidates.find((knowledge) => knowledge.tags.includes('project-snapshot')) ?? null;
  }

  private formatAssembledContext(
    taskDescription: string,
    project: string | undefined,
    sessionContext: string | undefined,
    projectSnapshot: KnowledgeUnit | undefined,
    curated: CuratedContext,
    options?: {
      includeTaskCuration?: boolean;
    },
  ): string {
    const sections: string[] = [`## Working Context for: ${taskDescription}`];

    if (project) {
      sections.push(`Project: ${project}`);
    }

    if (sessionContext) {
      sections.push('\n### Session Continuity');
      sections.push(sessionContext);
    }

    if (projectSnapshot) {
      sections.push('\n### Project Snapshot');
      sections.push(`Title: ${projectSnapshot.title}`);
      sections.push(projectSnapshot.solution);
    }

    if (options?.includeTaskCuration !== false) {
      sections.push('\n### Task Curation');
      sections.push(curated.summary);
    }

    return sections.join('\n').trim();
  }

  // ============================================================
  // Mutation sinks (for external mirrors like obsidian-sync)
  // ============================================================

  /** Register a sink that will be notified after every successful add/update/delete. */
  addMutationSink(sink: KnowledgeMutationSink): void {
    this.mutationSinks.push(sink);
  }

  removeMutationSink(sink: KnowledgeMutationSink): void {
    this.mutationSinks = this.mutationSinks.filter((s) => s !== sink);
  }

  private async notifySinks(
    kind: 'added' | 'updated' | 'deleted',
    payload: KnowledgeUnit | string,
  ): Promise<void> {
    for (const sink of this.mutationSinks) {
      try {
        if (kind === 'added' && sink.onAdded) {
          await sink.onAdded(payload as KnowledgeUnit);
        } else if (kind === 'updated' && sink.onUpdated) {
          await sink.onUpdated(payload as KnowledgeUnit);
        } else if (kind === 'deleted' && sink.onDeleted) {
          await sink.onDeleted(payload as string);
        }
      } catch (err) {
        // Sinks must never break the main mutation flow.
        console.warn(
          `[Mindstrate] mutation sink ${kind} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private tryIngestDerivedEvent(work: () => void): void {
    try {
      work();
    } catch (err) {
      console.warn(
        `[Mindstrate] derived event ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function projectToRetrievalResult(
  view: GraphKnowledgeView,
  relevanceScore: number,
  matchReason?: string,
): RetrievalResult {
  return {
    knowledge: {
      id: view.id,
      version: 1,
      type: mapGraphViewType(view),
      title: view.title,
      solution: view.summary,
      tags: view.tags,
      context: {
        project: view.project,
      },
      metadata: {
        author: 'ecs-projection',
        source: CaptureSource.AUTO_DETECT,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        confidence: view.priorityScore,
      },
      quality: {
        score: Math.round(view.priorityScore * 100),
        upvotes: 0,
        downvotes: 0,
        useCount: 0,
        verified: view.status === 'verified',
        status: KnowledgeStatus.ACTIVE,
      },
    },
    relevanceScore: Math.min(0.99, relevanceScore),
    matchReason: matchReason ?? `Graph projection | ${view.substrateType} | priority ${view.priorityScore.toFixed(2)}`,
  };
}

function mergeRetrievalResults(
  projected: RetrievalResult[],
  base: RetrievalResult[],
  topK: number,
): RetrievalResult[] {
  const merged: RetrievalResult[] = [];
  const seen = new Set<string>();

  for (const result of [...projected, ...base]) {
    if (seen.has(result.knowledge.id)) continue;
    seen.add(result.knowledge.id);
    merged.push(result);
    if (merged.length >= topK) break;
  }

  return merged;
}

function mapGraphViewType(view: GraphKnowledgeView): KnowledgeType {
  switch (view.substrateType) {
    case 'rule':
      return KnowledgeType.CONVENTION;
    case 'pattern':
      return KnowledgeType.PATTERN;
    case 'summary':
      return KnowledgeType.ARCHITECTURE;
    default:
      return KnowledgeType.BEST_PRACTICE;
  }
}

function computeGraphNodeMatchScore(tokens: string[], node: ContextNode): number {
  const haystack = `${node.title}\n${node.content}\n${node.tags.join(' ')}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;

  const lexicalScore = matched / tokens.length;
  const qualityScore = Math.min(node.qualityScore / 100, 1);
  const confidenceScore = Math.min(node.confidence, 1);
  return lexicalScore * 0.6 + qualityScore * 0.25 + confidenceScore * 0.15;
}
