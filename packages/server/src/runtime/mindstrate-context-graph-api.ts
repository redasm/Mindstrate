import type {
  FeedbackEvent,
  GraphKnowledgeSearchResult,
  GraphKnowledgeView,
} from '@mindstrate/protocol';
import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  SubstrateType,
  type ConflictRecord,
  type ContextEdge,
  type ContextNode,
  type ContextNodeStatus,
  type ContextRelationType,
  type ChangeSet,
} from '@mindstrate/protocol/models';
import type { CreateContextNodeInput, UpdateContextNodeInput } from '../context-graph/context-graph-store.js';
import type { GraphKnowledgeProjectionOptions } from '../context-graph/knowledge-projector.js';
import type { ProjectedKnowledgeSearchOptions } from '../context-graph/projected-knowledge-search.js';
import { computeGraphNodeMatchScore } from '../context-graph/graph-match-score.js';
import { ingestUserFeedback } from '../events/index.js';
import {
  enrichProjectGraph,
  detectProjectGraphChanges,
  detectProjectGraphChangeSet,
  estimateProjectGraphScanScope,
  estimateProjectGraphBlastRadius,
  findProjectGraphPath,
  indexProjectGraph,
  planProjectGraphSystemPagesWithLlm,
  collectCuratedProjectDocs,
  queryProjectGraphTask,
  recordProjectGraphExternalChanges,
  summarizeProjectGraphWithLlm,
  checkGeneratedEditSafety,
  checkUnrealModuleBoundaryConsistency,
  checkUnrealPluginDependencyConsistency,
  type GeneratedEditSafetyInput,
  type GeneratedEditSafetyIssue,
  type ProjectGraphBlastRadiusInput,
  type ProjectGraphBlastRadiusResult,
  type ProjectGraphEnrichmentInput,
  type ProjectGraphEnrichmentResult,
  type ProjectGraphIndexOptions,
  type ProjectGraphIndexResult,
  type ProjectGraphPathInput,
  type ProjectGraphPathResult,
  type ProjectGraphScanScope,
  type ProjectGraphChangeDetectionResult,
  type ProjectGraphChangeDetectionInput,
  type ProjectGraphExternalChangeRecordResult,
  type RecordProjectGraphExternalChangesInput,
  type ProjectGraphTaskQueryInput,
  type ProjectGraphTaskQueryResult,
  type UnrealModuleBoundaryConsistencyInput,
  type UnrealModuleBoundaryConsistencyIssue,
  type UnrealPluginDependencyConsistencyInput,
  type UnrealPluginDependencyConsistencyIssue,
} from '../project-graph/index.js';
import {
  writeProjectGraphArtifacts,
  writeProjectGraphObsidianProjection,
  internalizeSystemPagesAsRules,
  systemPageDefinitionsForProject,
  type InternalizeSystemPagesResult,
  type ProjectGraphArtifactResult,
  type ProjectGraphObsidianProjectionOptions,
  type SystemPageDefinition,
} from '../project-graph/index.js';
import {
  createProjectGraphOverlay,
  listProjectGraphOverlays,
  type CreateProjectGraphOverlayInput,
  type ListProjectGraphOverlayInput,
} from '../project-graph/index.js';
import type { ProjectGraphOverlay } from '@mindstrate/protocol/models';
import type { DetectedProject } from '../project/index.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateContextGraphApi {
  constructor(private readonly services: MindstrateRuntime) {}

  updateContextNode(id: string, input: UpdateContextNodeInput): ContextNode | null {
    return this.services.contextGraphStore.updateNode(id, input);
  }

  createContextNode(input: CreateContextNodeInput): ContextNode {
    return this.services.contextGraphStore.createNode(input);
  }

  deleteContextNode(id: string): boolean {
    return this.services.contextGraphStore.deleteNode(id);
  }

  getContextNode(id: string): ContextNode | null {
    return this.services.contextGraphStore.getNodeById(id);
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
  ): boolean {
    const applied = this.services.feedbackLoop.recordFeedback(retrievalId, signal, context);
    if (!applied) return false;
    this.tryIngestDerivedEvent(() => ingestUserFeedback(this.services.contextGraphStore, {
      retrievalId,
      signal,
      context,
    }));
    return true;
  }

  /**
   * Mint a retrieval ticket for a node. Mirrors what `assembleContext`
   * does automatically — exposed publicly so callers that surface
   * nodes via a non-assembly path (custom tools, evaluation harnesses,
   * tests) can still close the feedback loop properly instead of
   * passing a bare node id to `recordFeedback`.
   */
  trackRetrieval(nodeId: string, query: string, sessionId?: string): string {
    return this.services.feedbackLoop.trackRetrieval(nodeId, query, sessionId);
  }

  getFeedbackStats(nodeId: string) {
    return this.services.feedbackLoop.getFeedbackStats(nodeId);
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

  listKnownProjects(): string[] {
    return this.services.contextGraphStore.listKnownProjects();
  }

  listConflictRecords(project?: string, limit?: number): ConflictRecord[] {
    return this.services.contextGraphStore.listConflictRecords({ project, limit });
  }

  getConflictRecord(id: string): ConflictRecord | null {
    return this.services.contextGraphStore.getConflictRecordById(id);
  }

  listContextEdges(options?: {
    sourceId?: string;
    targetId?: string;
    relationType?: ContextRelationType;
    limit?: number;
  }): ContextEdge[] {
    return this.services.contextGraphStore.listEdges(options);
  }

  /** Bounded project-graph subgraph (skeleton or one-hop around a focus node). */
  queryProjectSubgraph(opts: {
    project: string;
    focusNodeId?: string;
    nodeKinds?: string[];
    limit?: number;
  }): { nodes: ContextNode[]; edges: ContextEdge[] } {
    return this.services.contextGraphStore.queryProjectSubgraph(opts);
  }

  /** Bounded BFS neighbourhood over project-graph edges from seed nodes. */
  projectGraphNeighborhood(opts: {
    seedIds: string[];
    depth: number;
    limit: number;
    edgeKinds?: string[];
  }): { nodes: ContextNode[]; edges: ContextEdge[] } {
    return this.services.contextGraphStore.projectGraphNeighborhood(opts);
  }

  /** Bounded BFS shortest path between two project-graph nodes. */
  projectGraphShortestPath(opts: {
    fromId: string;
    toId: string;
    maxDepth: number;
  }): { nodes: ContextNode[]; edges: ContextEdge[] } | null {
    return this.services.contextGraphStore.projectGraphShortestPath(opts);
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

  indexProjectGraph(project: DetectedProject, options?: ProjectGraphIndexOptions): ProjectGraphIndexResult {
    return indexProjectGraph(this.services.contextGraphStore, project, {
      logger: this.services.logger,
      ...options,
    });
  }

  detectProjectGraphChanges(
    project: DetectedProject,
    input: ProjectGraphChangeDetectionInput,
  ): ProjectGraphChangeDetectionResult {
    return detectProjectGraphChanges(this.services.contextGraphStore, project, input);
  }

  ingestProjectGraphChangeSet(
    project: DetectedProject,
    changeSet: ChangeSet,
  ): ProjectGraphChangeDetectionResult {
    return detectProjectGraphChangeSet(this.services.contextGraphStore, project, changeSet);
  }

  /**
   * Persist staleness markers for one upstream change event (commit /
   * changelist) seen by an external scanner. Unlike
   * `ingestProjectGraphChangeSet` this writes to the graph: affected nodes
   * and the project node get an `externalChanges` marker that change
   * detection surfaces as risk hints until the next reindex clears it.
   */
  recordProjectGraphExternalChanges(
    input: RecordProjectGraphExternalChangesInput,
  ): ProjectGraphExternalChangeRecordResult {
    return recordProjectGraphExternalChanges(this.services.contextGraphStore, input);
  }

  async enrichProjectGraph(
    project: DetectedProject,
    options?: Pick<ProjectGraphEnrichmentInput, 'summarize'>,
  ): Promise<ProjectGraphEnrichmentResult> {
    const providers = this.services.providerFactory.forProject(project.name);
    const summarize = options?.summarize ?? await this.createProjectGraphSummarizer(project);
    return enrichProjectGraph(this.services.contextGraphStore, {
      project: project.name,
      llmConfigured: providers.hasConfig,
      extractedNodes: this.services.contextGraphStore.listNodes({
        project: project.name,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
      summarize,
    });
  }

  async planProjectGraphSystemPages(project: DetectedProject): Promise<SystemPageDefinition[] | null> {
    const providers = this.services.providerFactory.forProject(project.name);
    if (!providers.hasConfig) return null;
    const client = await providers.llmClientPromise;
    if (!client) return null;
    return planProjectGraphSystemPagesWithLlm({
      client,
      model: providers.llmModel,
      project,
      extractedNodes: this.services.contextGraphStore.listNodes({
        project: project.name,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
      curatedDocs: collectCuratedProjectDocs(project),
      requestPolicy: this.services.config.projectGraphLlm,
    });
  }

  estimateProjectGraphScanScope(
    project: DetectedProject,
    options?: Pick<ProjectGraphIndexOptions, 'onScanProgress'>,
  ): ProjectGraphScanScope {
    return estimateProjectGraphScanScope(project.root, {
      sourceRoots: project.graphHints?.sourceRoots,
      ignore: project.graphHints?.ignore,
      generatedRoots: project.graphHints?.generatedRoots,
      metadataOnlyRoots: project.graphHints?.layers
        ?.filter((layer) => layer.parserAdapters.includes('unreal-asset-metadata'))
        .flatMap((layer) => layer.roots),
      manifests: project.graphHints?.manifests,
      llmProviderConfigured: this.services.providerFactory.forProject(project.name).hasConfig,
      onProgress: options?.onScanProgress,
    });
  }

  writeProjectGraphArtifacts(project: DetectedProject): ProjectGraphArtifactResult {
    return writeProjectGraphArtifacts(this.services.contextGraphStore, project);
  }

  writeProjectGraphObsidianProjection(
    project: DetectedProject,
    vaultRoot: string,
    options?: ProjectGraphObsidianProjectionOptions,
  ): ProjectGraphArtifactResult {
    return writeProjectGraphObsidianProjection(this.services.contextGraphStore, project, vaultRoot, options);
  }

  /**
   * Internalize the project's system pages (architecture/operation-manual book)
   * as queryable `systemPage` RULE nodes — the same nodes the MCP before-edit /
   * impact task report reads for project-specific guidance. The Obsidian
   * projection does this as a side effect for local mode; team-mode scanning has
   * no vault, so this exposes it as a standalone step to keep AI guidance at
   * parity across modes. Deterministic and idempotent.
   */
  internalizeSystemPages(
    project: DetectedProject,
    systemPages?: SystemPageDefinition[],
  ): InternalizeSystemPagesResult {
    const pages = systemPages ?? systemPageDefinitionsForProject(project);
    return internalizeSystemPagesAsRules(this.services.contextGraphStore, project, pages);
  }

  createProjectGraphOverlay(input: CreateProjectGraphOverlayInput): ProjectGraphOverlay {
    return createProjectGraphOverlay(this.services.contextGraphStore, input);
  }

  listProjectGraphOverlays(input?: ListProjectGraphOverlayInput): ProjectGraphOverlay[] {
    return listProjectGraphOverlays(this.services.contextGraphStore, input);
  }

  /**
   * Find the shortest bounded path between two project graph nodes.
   *
   * Loads `nodes`/`edges` for `projectScope` (a project name) automatically
   * when the caller does not provide them.
   */
  findProjectGraphPath(input: Omit<ProjectGraphPathInput, 'nodes' | 'edges'> & {
    projectScope?: string;
    nodes?: ProjectGraphPathInput['nodes'];
    edges?: ProjectGraphPathInput['edges'];
  }): ProjectGraphPathResult {
    const { projectScope, ...rest } = input;
    const { nodes, edges } = this.loadGraphForAnalysis(projectScope, input.nodes, input.edges);
    return findProjectGraphPath({ ...rest, nodes, edges });
  }

  /** Estimate blast radius around a project graph node. */
  estimateProjectGraphBlastRadius(input: Omit<ProjectGraphBlastRadiusInput, 'nodes' | 'edges'> & {
    projectScope?: string;
    nodes?: ProjectGraphBlastRadiusInput['nodes'];
    edges?: ProjectGraphBlastRadiusInput['edges'];
  }): ProjectGraphBlastRadiusResult {
    const { projectScope, ...rest } = input;
    const { nodes, edges } = this.loadGraphForAnalysis(projectScope, input.nodes, input.edges);
    return estimateProjectGraphBlastRadius({ ...rest, nodes, edges });
  }

  /** Run a task-oriented project graph query template. */
  queryProjectGraphTask(input: Omit<ProjectGraphTaskQueryInput, 'nodes' | 'edges'> & {
    projectScope?: string;
    nodes?: ProjectGraphTaskQueryInput['nodes'];
    edges?: ProjectGraphTaskQueryInput['edges'];
  }): ProjectGraphTaskQueryResult {
    const { projectScope, ...rest } = input;
    const { nodes, edges } = this.loadGraphForAnalysis(projectScope, input.nodes, input.edges);
    return queryProjectGraphTask({ ...rest, nodes, edges });
  }

  /** Detect generated-edit safety issues against the current graph. */
  checkGeneratedEditSafety(input: Omit<GeneratedEditSafetyInput, 'nodes' | 'edges'> & {
    projectScope?: string;
    nodes?: GeneratedEditSafetyInput['nodes'];
    edges?: GeneratedEditSafetyInput['edges'];
  }): GeneratedEditSafetyIssue[] {
    const { projectScope, ...rest } = input;
    const { nodes, edges } = this.loadGraphForAnalysis(projectScope, input.nodes, input.edges);
    return checkGeneratedEditSafety({ ...rest, nodes, edges });
  }

  /** Detect Unreal plugin-dependency consistency issues. */
  checkUnrealPluginDependencyConsistency(input?: {
    projectScope?: string;
    nodes?: UnrealPluginDependencyConsistencyInput['nodes'];
    edges?: UnrealPluginDependencyConsistencyInput['edges'];
  }): UnrealPluginDependencyConsistencyIssue[] {
    const { nodes, edges } = this.loadGraphForAnalysis(input?.projectScope, input?.nodes, input?.edges);
    return checkUnrealPluginDependencyConsistency({ nodes, edges });
  }

  /** Detect Unreal module-boundary consistency issues. */
  checkUnrealModuleBoundaryConsistency(input?: {
    projectScope?: string;
    nodes?: UnrealModuleBoundaryConsistencyInput['nodes'];
    edges?: UnrealModuleBoundaryConsistencyInput['edges'];
  }): UnrealModuleBoundaryConsistencyIssue[] {
    const { nodes, edges } = this.loadGraphForAnalysis(input?.projectScope, input?.nodes, input?.edges);
    return checkUnrealModuleBoundaryConsistency({ nodes, edges });
  }

  private loadGraphForAnalysis(
    projectScope: string | undefined,
    nodes: ContextNode[] | undefined,
    edges: ContextEdge[] | undefined,
  ): { nodes: ContextNode[]; edges: ContextEdge[] } {
    if (nodes && edges) return { nodes, edges };
    return {
      nodes: nodes ?? this.services.contextGraphStore.listNodes({
        project: projectScope,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
      edges: edges ?? this.services.contextGraphStore.listEdges({
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
    };
  }

  private tryIngestDerivedEvent(work: () => void): void {
    try {
      work();
    } catch (err) {
      this.services.logger.warn(
        `[Mindstrate] derived event ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async createProjectGraphSummarizer(
    project: DetectedProject,
  ): Promise<ProjectGraphEnrichmentInput['summarize'] | undefined> {
    const providers = this.services.providerFactory.forProject(project.name);
    if (!providers.hasConfig) return undefined;
    const client = await providers.llmClientPromise;
    if (!client) return undefined;
    return () => summarizeProjectGraphWithLlm({
      client,
      model: providers.llmModel,
      project: project.name,
      extractedNodes: this.services.contextGraphStore.listNodes({
        project: project.name,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
      requestPolicy: this.services.config.projectGraphLlm,
    });
  }
}

