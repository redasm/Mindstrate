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
  indexProjectGraph,
  summarizeProjectGraphWithLlm,
  type ProjectGraphEnrichmentInput,
  type ProjectGraphEnrichmentResult,
  type ProjectGraphIndexOptions,
  type ProjectGraphIndexResult,
  type ProjectGraphScanScope,
  type ProjectGraphChangeDetectionResult,
  type ProjectGraphChangeDetectionInput,
} from '../project-graph/index.js';
import {
  writeProjectGraphArtifacts,
  writeProjectGraphObsidianProjection,
  type ProjectGraphArtifactResult,
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
import { getOpenAIClient } from '../openai-client.js';

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

  indexProjectGraph(project: DetectedProject, options?: ProjectGraphIndexOptions): ProjectGraphIndexResult {
    return indexProjectGraph(this.services.contextGraphStore, project, options);
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

  async enrichProjectGraph(
    project: DetectedProject,
    options?: Pick<ProjectGraphEnrichmentInput, 'summarize'>,
  ): Promise<ProjectGraphEnrichmentResult> {
    const summarize = options?.summarize ?? await this.createProjectGraphSummarizer(project);
    return enrichProjectGraph(this.services.contextGraphStore, {
      project: project.name,
      llmConfigured: this.services.config.openaiApiKey.length > 0,
      extractedNodes: this.services.contextGraphStore.listNodes({
        project: project.name,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
      summarize,
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
      llmProviderConfigured: this.services.config.openaiApiKey.length > 0,
      onProgress: options?.onScanProgress,
    });
  }

  writeProjectGraphArtifacts(project: DetectedProject): ProjectGraphArtifactResult {
    return writeProjectGraphArtifacts(this.services.contextGraphStore, project);
  }

  writeProjectGraphObsidianProjection(project: DetectedProject, vaultRoot: string): ProjectGraphArtifactResult {
    return writeProjectGraphObsidianProjection(this.services.contextGraphStore, project, vaultRoot);
  }

  createProjectGraphOverlay(input: CreateProjectGraphOverlayInput): ProjectGraphOverlay {
    return createProjectGraphOverlay(this.services.contextGraphStore, input);
  }

  listProjectGraphOverlays(input?: ListProjectGraphOverlayInput): ProjectGraphOverlay[] {
    return listProjectGraphOverlays(this.services.contextGraphStore, input);
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

  private async createProjectGraphSummarizer(
    project: DetectedProject,
  ): Promise<ProjectGraphEnrichmentInput['summarize'] | undefined> {
    if (!this.services.config.openaiApiKey) return undefined;
    const client = await getOpenAIClient(this.services.config.openaiApiKey, this.services.config.openaiBaseUrl);
    if (!client) return undefined;
    return () => summarizeProjectGraphWithLlm({
      client,
      model: this.services.config.llmModel,
      project: project.name,
      extractedNodes: this.services.contextGraphStore.listNodes({
        project: project.name,
        domainType: ContextDomainType.ARCHITECTURE,
        limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
      }),
    });
  }
}

