import type {
  AddKnowledgeResult,
  AssembledContext,
  CreateKnowledgeInput,
  FeedbackEvent,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
  RetrievalContext,
} from '@mindstrate/protocol';
import {
  ContextDomainType,
  ContextEventType,
  SubstrateType,
  type ConflictRecord,
  type ContextEdge,
  type ContextEvent,
  type ContextNode,
  type ContextNodeStatus,
  type ContextRelationType,
  type CuratedContext,
} from '@mindstrate/protocol/models';
import {
  buildProjectSnapshot,
  type DetectedProject,
} from '../project/index.js';
import { runContextAssemblyDag } from '../context-graph/context-assembly-dag.js';
import type { CreateContextNodeInput, UpdateContextNodeInput } from '../context-graph/context-graph-store.js';
import { toGraphKnowledgeView } from '../context-graph/knowledge-projector.js';
import type { GraphKnowledgeProjectionOptions } from '../context-graph/knowledge-projector.js';
import type { ProjectedKnowledgeSearchOptions } from '../context-graph/projected-knowledge-search.js';
import { digestKnowledgeInput } from '../context-graph/knowledge-digest.js';
import {
  ingestContextEvent,
  ingestGitActivity,
  ingestLspDiagnostic,
  ingestTerminalOutput,
  ingestTestRun,
  ingestUserFeedback,
  type IngestContextEventInput,
} from '../events/index.js';
import {
  computeGraphNodeMatchScore,
  generateGraphCurationSummary,
  getStringMetadata,
  knowledgeTypeToContextDomain,
} from '../mindstrate-graph-helpers.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateGraphApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
    private readonly loadSessionContext: (project?: string) => string,
  ) {}

  async add(input: CreateKnowledgeInput): Promise<AddKnowledgeResult> {
    await this.ensureInit();
    const gateResult = this.services.qualityGate.check(input);
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
    const embedding = await this.services.embedder.embed(text);
    const duplicates = await this.services.vectorStore.findDuplicates(
      embedding,
      this.services.config.deduplicationThreshold,
    );

    if (duplicates.length > 0) {
      const duplicate = duplicates[0];
      return {
        success: false,
        message: `Duplicate detected (similarity: ${(duplicate.score * 100).toFixed(1)}%). Existing knowledge ID: ${duplicate.id}`,
        duplicateOf: duplicate.id,
      };
    }

    const node = this.services.contextGraphStore.createNode(digested.nodeInput);
    this.services.contextGraphStore.createEvent({
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
    await this.services.vectorStore.add({
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
    this.services.projectionMaterializer.materialize({ project: node.project, limit: 50 });

    return {
      success: true,
      view: toGraphKnowledgeView(node),
      message: `Context node added successfully: ${node.title}`,
      qualityWarnings: gateResult.warnings.length > 0 ? gateResult.warnings : undefined,
    };
  }

  async upsertProjectSnapshot(
    project: DetectedProject,
    options: { author?: string; trusted?: boolean } = {},
  ): Promise<{ node: ContextNode; view: GraphKnowledgeView; changed: boolean; created: boolean }> {
    await this.ensureInit();

    const { id } = buildProjectSnapshot(project, options);
    const existingNode = this.services.contextGraphStore.getNodeById(id);
    const built = buildProjectSnapshot(project, {
      ...options,
      previousSolution: existingNode?.content,
    });
    const nodeInput = this.createSnapshotNodeInput(id, built, options);
    const created = !existingNode;
    const node = existingNode
      ? this.services.contextGraphStore.updateNode(id, nodeInput)!
      : this.services.contextGraphStore.createNode(nodeInput);

    await this.indexSnapshotNode(node, id);

    if (created || built.changed) {
      this.services.contextGraphStore.createEvent({
        type: ContextEventType.PROJECT_SNAPSHOT,
        project: node.project,
        actor: typeof node.metadata?.['author'] === 'string' ? node.metadata['author'] : undefined,
        content: node.content,
        metadata: { nodeId: node.id },
      });
      this.services.projectSnapshotProjectionMaterializer.materialize({ project: node.project, limit: 10 });
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
    return this.services.contextGraphStore.getNodeById(id);
  }

  checkQuality(input: CreateKnowledgeInput) {
    return this.services.qualityGate.check(input);
  }

  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    sessionId?: string,
  ): Promise<CuratedContext> {
    await this.ensureInit();
    const project = context?.project;
    const graphSelection = this.services.contextPrioritySelector.select({
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
    const sections = this.formatCurationSections(
      taskDescription,
      graphSelection,
      conflicts,
      knowledge,
      workflows,
      warnings,
    );

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
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    await this.ensureInit();
    const queryEmbedding = await this.services.embedder.embed(taskDescription);
    const graphSelection = this.services.contextPrioritySelector.select({
      project: options?.project ?? options?.context?.project,
      context: options?.context,
      queryEmbedding,
      embeddingModel: this.services.config.embeddingModel,
      perLayerLimit: 5,
    });
    const result = await runContextAssemblyDag(
      {
        taskDescription,
        project: options?.project,
        context: options?.context,
        sessionId: options?.sessionId,
        maxSummaryCharacters: options?.maxSummaryCharacters,
      },
      {
        loadSessionContext: (project) => project ? this.loadSessionContext(project) || undefined : undefined,
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
          summaryOptions,
        ) => this.formatAssembledContext(
          task,
          project,
          sessionContext,
          projectSnapshot,
          curated,
          summaryOptions,
        ),
      },
    );

    return result.assembled;
  }

  assembleWorkingContext(
    taskDescription: string,
    options?: {
      project?: string;
      context?: RetrievalContext;
      sessionId?: string;
      maxSummaryCharacters?: number;
    },
  ): Promise<AssembledContext> {
    return this.assembleContext(taskDescription, options);
  }

  updateContextNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.services.contextGraphStore.updateNode(id, input);
  }

  createContextNode(input: CreateContextNodeInput): ContextNode {
    return this.services.contextGraphStore.createNode(input);
  }

  deleteContextNode(id: string): boolean {
    return this.services.contextGraphStore.deleteNode(id);
  }

  upvote(id: string): void {
    const node = this.services.contextGraphStore.getNodeById(id);
    if (!node) return;
    this.services.contextGraphStore.updateNode(id, {
      positiveFeedback: node.positiveFeedback + 1,
    });
  }

  downvote(id: string): void {
    const node = this.services.contextGraphStore.getNodeById(id);
    if (!node) return;
    this.services.contextGraphStore.updateNode(id, {
      negativeFeedback: node.negativeFeedback + 1,
    });
  }

  recordFeedback(
    retrievalId: string,
    signal: FeedbackEvent['signal'],
    context?: string,
  ): void {
    this.services.feedbackLoop.recordFeedback(retrievalId, signal, context);
    this.tryIngestDerivedEvent(() => ingestUserFeedback(this.services.contextGraphStore, {
      retrievalId,
      signal,
      context,
    }));
  }

  getFeedbackStats(nodeId: string) {
    return this.services.feedbackLoop.getFeedbackStats(nodeId);
  }

  ingestEvent(input: IngestContextEventInput): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestContextEvent(this.services.contextGraphStore, input);
  }

  ingestGitActivity(input: {
    content: string;
    project?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestGitActivity(this.services.contextGraphStore, input);
  }

  ingestTestRun(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestTestRun(this.services.contextGraphStore, input);
  }

  ingestLspDiagnostic(input: {
    content: string;
    project?: string;
    sessionId?: string;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestLspDiagnostic(this.services.contextGraphStore, input);
  }

  ingestTerminalOutput(input: {
    content: string;
    project?: string;
    sessionId?: string;
    actor?: string;
    command?: string;
    exitCode?: number;
    sourceRef?: string;
    metadata?: Record<string, unknown>;
  }): { event: ContextEvent; node: ContextNode; previousNodeId?: string } {
    return ingestTerminalOutput(this.services.contextGraphStore, input);
  }

  listContextNodes(options?: {
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    sourceRef?: string;
    limit?: number;
  }): ContextNode[] {
    return this.services.contextGraphStore.listNodes(options);
  }

  listConflictRecords(project?: string, limit?: number): ConflictRecord[] {
    return this.services.contextGraphStore.listConflictRecords({ project, limit });
  }

  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: ContextRelationType;
    limit?: number;
  }): ContextEdge[] {
    return this.services.contextGraphStore.listEdges(options);
  }

  queryContextGraph(options?: {
    query?: string;
    project?: string;
    substrateType?: SubstrateType;
    domainType?: ContextDomainType;
    status?: ContextNodeStatus;
    limit?: number;
  }): ContextNode[] {
    const nodes = this.services.contextGraphStore.listNodes({
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

  readGraphKnowledge(options?: GraphKnowledgeProjectionOptions): GraphKnowledgeView[] {
    return this.services.graphKnowledgeProjector.project(options);
  }

  queryGraphKnowledge(
    query: string,
    options?: ProjectedKnowledgeSearchOptions,
  ): GraphKnowledgeSearchResult[] {
    const results = this.services.projectedKnowledgeSearch.search(query, options);
    if (options?.trackFeedback === false) return results;

    return results.map((result) => ({
      ...result,
      retrievalId: this.services.feedbackLoop.trackRetrieval(
        result.view.id,
        query,
        options?.sessionId,
      ),
    }));
  }

  private createSnapshotNodeInput(
    id: string,
    built: ReturnType<typeof buildProjectSnapshot>,
    options: { author?: string; trusted?: boolean },
  ): CreateContextNodeInput {
    return {
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
  }

  private async indexSnapshotNode(node: ContextNode, id: string): Promise<void> {
    try {
      const text = `${node.title}\n${node.content}`;
      const embedding = await this.services.embedder.embed(text);
      await this.services.vectorStore.delete(id);
      await this.services.vectorStore.add({
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
      console.warn(
        `[Mindstrate] project snapshot embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private formatCurationSections(
    taskDescription: string,
    graphSelection: {
      rules: ContextNode[];
      patterns: ContextNode[];
      summaries: ContextNode[];
    },
    conflicts: ConflictRecord[],
    knowledge: GraphKnowledgeSearchResult[],
    workflows: GraphKnowledgeSearchResult[],
    warnings: GraphKnowledgeSearchResult[],
  ): string[] {
    const sections: string[] = [`## Context for: ${taskDescription}`];
    this.appendTitles(sections, 'Operational Rules', graphSelection.rules);
    this.appendTitles(sections, 'Repeated Patterns', graphSelection.patterns);
    this.appendTitles(sections, 'Recent Summary Clusters', graphSelection.summaries);
    if (conflicts.length > 0) {
      sections.push('\n### Active Conflicts');
      sections.push(...conflicts.map((record) => `- ${record.reason}`));
    }
    sections.push('\n### Task Curation');
    sections.push(generateGraphCurationSummary(taskDescription, knowledge, workflows, warnings));
    return sections;
  }

  private appendTitles(sections: string[], title: string, nodes: ContextNode[]): void {
    if (nodes.length === 0) return;
    sections.push(`\n### ${title}`);
    sections.push(...nodes.map((node) => `- ${node.title}`));
  }

  private findProjectSnapshot(project: string): ContextNode | null {
    return this.services.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      limit: 1,
    })[0] ?? null;
  }

  private findExactGraphDuplicate(input: CreateKnowledgeInput): ContextNode | null {
    const title = input.title.trim();
    const content = input.solution.trim();
    const candidates = this.services.contextGraphStore.listNodes({
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
    if (project) sections.push(`Project: ${project}`);
    if (sessionContext) sections.push('\n### Session Continuity', sessionContext);
    if (projectSnapshot) {
      sections.push('\n### Project Snapshot', `Title: ${projectSnapshot.title}`, projectSnapshot.content);
    }
    if (options?.includeTaskCuration !== false) {
      sections.push('\n### Task Curation', curated.summary);
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
