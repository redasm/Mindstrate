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
  RetrievalContext,
  AssembledContext,
  FeedbackEvent,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
} from '@mindstrate/protocol';
import { CaptureSource, KnowledgeType } from '@mindstrate/protocol';
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
  ObsidianProjectionMaterializer,
  ProjectSnapshotProjectionMaterializer,
  SessionProjectionMaterializer,
} from './projections/index.js';
import { ContextDomainType, ContextEventType, SubstrateType } from '@mindstrate/protocol/models';
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
import type { CreateContextNodeInput, UpdateContextNodeInput } from './context-graph/context-graph-store.js';
import { digestKnowledgeInput } from './context-graph/knowledge-digest.js';
import {
  ingestContextEvent,
  ingestGitActivity,
  ingestLspDiagnostic,
  ingestTestRun,
  ingestUserFeedback,
  type IngestContextEventInput,
} from './events/index.js';
import { PortableContextBundleManager, type CreateBundleOptions, type EditableBundleFiles, type InstallBundleFromRegistryOptions, type InstallBundleResult, type PublishBundleOptions, type PublishBundleResult, type ValidateBundleResult } from './bundles/index.js';

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

    const exactDuplicate = this.findExactGraphDuplicate(input);
    if (exactDuplicate) {
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
      return {
        success: false,
        message: `Duplicate detected (similarity: ${(dup.score * 100).toFixed(1)}%). Existing knowledge ID: ${dup.id}`,
        duplicateOf: dup.id,
      };
    }

    const node = this.contextGraphStore.createNode(digested.nodeInput);
    this.contextGraphStore.createEvent({
      type: ContextEventType.KNOWLEDGE_WRITE,
      project: node.project,
      actor: input.author,
      content: `${node.title}\n${node.content}`,
      metadata: {
        nodeId: node.id,
        domainType: node.domainType,
        substrateType: node.substrateType,
      },
    });
    await this.vectorStore.add({
      id: node.id,
      embedding,
      text,
      metadata: {
        type: node.domainType,
        language: getStringMetadata(node, 'context', 'language'),
        framework: getStringMetadata(node, 'context', 'framework'),
        project: node.project ?? '',
      },
    });
    this.projectionMaterializer.materialize({ project: node.project, limit: 50 });

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
  ): Promise<{ node: ContextNode; view: GraphKnowledgeView; changed: boolean; created: boolean }> {
    await this.ensureInit();

    const { id } = buildProjectSnapshot(project, options);
    const existingNode = this.contextGraphStore.getNodeById(id);
    const previousSolution = existingNode?.content;
    const built = buildProjectSnapshot(project, { ...options, previousSolution });

    const nodeInput: CreateContextNodeInput = {
      id,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      title: built.input.title,
      content: built.input.solution,
      tags: built.input.tags,
      project: built.input.context?.project,
      compressionLevel: 0.02,
      confidence: built.input.confidence,
      qualityScore: options.trusted ? 90 : 70,
      status: 'active' as ContextNodeStatus,
      sourceRef: id,
      metadata: {
        problem: built.input.problem,
        actionable: built.input.actionable,
        context: built.input.context,
        author: built.input.author,
        source: built.input.source,
      },
    };

    const created = !existingNode;
    const node = existingNode
      ? this.contextGraphStore.updateNode(id, {
        title: nodeInput.title,
        content: nodeInput.content,
        tags: nodeInput.tags,
        project: nodeInput.project,
        compressionLevel: nodeInput.compressionLevel,
        confidence: nodeInput.confidence,
        qualityScore: nodeInput.qualityScore,
        status: nodeInput.status,
        sourceRef: nodeInput.sourceRef,
        metadata: nodeInput.metadata,
      })!
      : this.contextGraphStore.createNode(nodeInput);

    try {
      const text = `${node.title}\n${node.content}`;
      const embedding = await this.embedder.embed(text);
      await this.vectorStore.delete(id);
      await this.vectorStore.add({
        id,
        embedding,
        text,
        metadata: {
          type: node.domainType,
          language: getStringMetadata(node, 'context', 'language'),
          framework: getStringMetadata(node, 'context', 'framework'),
          project: node.project ?? '',
        },
      });
    } catch (err) {
      // Embedding failures shouldn't break init; the metadata is still queryable.
      console.warn(
        `[Mindstrate] project snapshot embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (created || built.changed) {
      this.contextGraphStore.createEvent({
        type: ContextEventType.PROJECT_SNAPSHOT,
        project: node.project,
        actor: typeof node.metadata?.['author'] === 'string' ? node.metadata['author'] : undefined,
        content: node.content,
        metadata: { nodeId: node.id },
      });
      this.projectSnapshotProjectionMaterializer.materialize({ project: node.project, limit: 10 });
    }

    const view = this.readGraphKnowledge({ project: node.project, limit: 100 })
      .find((entry) => entry.id === node.id);

    return {
      node,
      view: view ?? toGraphKnowledgeView(node),
      changed: built.changed || created,
      created,
    };
  }

  getProjectSnapshot(project: DetectedProject): ContextNode | null {
    const { id } = buildProjectSnapshot(project);
    return this.contextGraphStore.getNodeById(id);
  }

  /** 质量门禁预检查（不写入，仅检查质量） */
  checkQuality(input: CreateKnowledgeInput): QualityGateResult {
    return this.pipeline.qualityGate(input);
  }

  // ============================================================
  // 知识检索
  // ============================================================

  /**
   * 上下文策划：自动组装任务知识包
   */
  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    _sessionId?: string,
  ): Promise<CuratedContext> {
    await this.ensureInit();
    const project = context?.project;
    const graphSelection = this.contextPrioritySelector.select({
      project,
      perLayerLimit: 5,
    });
    const conflicts = this.listConflictRecords(project, 5);
    const knowledge = this.queryGraphKnowledge(taskDescription, { project, limit: 5 });
    const workflows = this.queryGraphKnowledge(taskDescription, { project, limit: 10 })
      .filter((result) => result.view.domainType === ContextDomainType.WORKFLOW)
      .slice(0, 3);
    const warnings = this.queryGraphKnowledge(`common mistakes pitfalls when ${taskDescription}`, {
      project,
      limit: 3,
    });

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
    sections.push(generateGraphCurationSummary(taskDescription, knowledge, workflows, warnings));

    return {
      taskDescription,
      knowledge,
      workflows,
      warnings,
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

  updateContextNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.contextGraphStore.updateNode(id, input);
  }

  createContextNode(input: CreateContextNodeInput): ContextNode {
    return this.contextGraphStore.createNode(input);
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
    return {
      total: this.contextGraphStore.listNodes({ limit: 100000 }).length,
      updated: 0,
      deprecated: 0,
      outdated: 0,
    };
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
    const nodes = this.contextGraphStore.listNodes({ limit: 100000 });
    const dbStats = getGraphStats(nodes);
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

  private findProjectSnapshot(project: string): ContextNode | null {
    return this.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      limit: 1,
    })[0] ?? null;
  }

  private findExactGraphDuplicate(input: CreateKnowledgeInput): ContextNode | null {
    const title = input.title.trim();
    const content = input.solution.trim();
    const candidates = this.contextGraphStore.listNodes({
      project: input.context?.project,
      domainType: knowledgeTypeToContextDomain(input.type),
      limit: 500,
    });
    return candidates.find((node) =>
      node.title === title &&
      node.content === content &&
      getStringMetadata(node, 'context', 'language') === (input.context?.language ?? '') &&
      getStringMetadata(node, 'context', 'framework') === (input.context?.framework ?? '')
    ) ?? null;
  }

  private formatAssembledContext(
    taskDescription: string,
    project: string | undefined,
    sessionContext: string | undefined,
    projectSnapshot: ContextNode | undefined,
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
      sections.push(projectSnapshot.content);
    }

    if (options?.includeTaskCuration !== false) {
      sections.push('\n### Task Curation');
      sections.push(curated.summary);
    }

    return sections.join('\n').trim();
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

function computeGraphNodeMatchScore(tokens: string[], node: ContextNode): number {
  const haystack = `${node.title}\n${node.content}\n${node.tags.join(' ')}`.toLowerCase();
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  if (matched === 0) return 0;

  const lexicalScore = matched / tokens.length;
  const qualityScore = Math.min(node.qualityScore / 100, 1);
  const confidenceScore = Math.min(node.confidence, 1);
  return lexicalScore * 0.6 + qualityScore * 0.25 + confidenceScore * 0.15;
}

function generateGraphCurationSummary(
  task: string,
  knowledge: GraphKnowledgeSearchResult[],
  workflows: GraphKnowledgeSearchResult[],
  warnings: GraphKnowledgeSearchResult[],
): string {
  const parts: string[] = [`Curated graph context for: ${task}`];
  if (knowledge.length > 0) {
    parts.push(`Relevant graph knowledge: ${knowledge.map((result) => result.view.title).join(', ')}`);
  }
  if (workflows.length > 0) {
    parts.push(`Applicable workflows: ${workflows.map((result) => result.view.title).join(', ')}`);
  }
  if (warnings.length > 0) {
    parts.push(`Potential pitfalls: ${warnings.map((result) => result.view.title).join(', ')}`);
  }
  if (parts.length === 1) {
    parts.push('No directly matching graph knowledge found. Use project/session substrate and proceed carefully.');
  }
  return parts.join('\n');
}

function getGraphStats(nodes: ContextNode[]): {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byLanguage: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const node of nodes) {
    byType[node.domainType] = (byType[node.domainType] ?? 0) + 1;
    byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
    const language = getStringMetadata(node, 'context', 'language');
    if (language) {
      byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    }
  }

  return {
    total: nodes.length,
    byType,
    byStatus,
    byLanguage,
  };
}

function getStringMetadata(node: ContextNode, objectKey: string, valueKey: string): string {
  const value = node.metadata?.[objectKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const nested = (value as Record<string, unknown>)[valueKey];
  return typeof nested === 'string' ? nested : '';
}

function knowledgeTypeToContextDomain(type: CreateKnowledgeInput['type']): ContextDomainType {
  switch (type) {
    case KnowledgeType.BUG_FIX:
      return ContextDomainType.BUG_FIX;
    case KnowledgeType.BEST_PRACTICE:
      return ContextDomainType.BEST_PRACTICE;
    case KnowledgeType.ARCHITECTURE:
      return ContextDomainType.ARCHITECTURE;
    case KnowledgeType.CONVENTION:
      return ContextDomainType.CONVENTION;
    case KnowledgeType.PATTERN:
      return ContextDomainType.PATTERN;
    case KnowledgeType.TROUBLESHOOTING:
      return ContextDomainType.TROUBLESHOOTING;
    case KnowledgeType.GOTCHA:
      return ContextDomainType.GOTCHA;
    case KnowledgeType.HOW_TO:
      return ContextDomainType.HOW_TO;
    case KnowledgeType.WORKFLOW:
      return ContextDomainType.WORKFLOW;
    default:
      return ContextDomainType.BEST_PRACTICE;
  }
}
