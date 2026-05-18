import type {
  AssembledContext,
  AssembledRetrieval,
  CuratedContext,
  GraphKnowledgeSearchResult,
  ProjectGraphContextFact,
  RetrievalContext,
} from '@mindstrate/protocol';
import {
  ContextDomainType,
  PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
  SubstrateType,
  type ConflictRecord,
  type ContextNode,
} from '@mindstrate/protocol/models';
import { runContextAssemblyDag } from '../context-graph/context-assembly-dag.js';
import { generateGraphCurationSummary } from '../context-graph/graph-curation-summary.js';
import { selectProjectGraphAssemblyFacts } from '../context-graph/project-graph-assembly-selector.js';
import type { MindstrateRuntime } from './mindstrate-runtime.js';

export class MindstrateContextAssemblyApi {
  constructor(
    private readonly services: MindstrateRuntime,
    private readonly ensureInit: () => Promise<void>,
    private readonly loadSessionContext: (project?: string) => string,
    private readonly queryGraphKnowledge: (
      query: string,
      options?: { project?: string; limit?: number; includeProjectGraphNodes?: boolean },
    ) => GraphKnowledgeSearchResult[],
    private readonly listConflictRecords: (project?: string, limit?: number) => ConflictRecord[],
  ) {}

  async curateContext(
    taskDescription: string,
    context?: RetrievalContext,
    _sessionId?: string,
  ): Promise<CuratedContext> {
    await this.ensureInit();
    const project = context?.project;
    const graphSelection = this.services.contextPrioritySelector.select({
      project,
      perLayerLimit: 5,
    });
    const conflicts = this.listConflictRecords(project, 5);
    // The assembled context already surfaces project graph nodes via
    // `loadProjectGraphFacts` (a separate, file/edge-aware traversal),
    // so the Curated Context layer should focus on `RULE / PATTERN /
    // SUMMARY / SKILL` knowledge instead of double-listing dependency
    // / file nodes here. This is the one place that opts out of the
    // default-on `includeProjectGraphNodes` change made in
    // `ProjectedKnowledgeSearch.search`.
    const knowledge = this.queryGraphKnowledge(taskDescription, { project, limit: 5, includeProjectGraphNodes: false });
    const workflows = this.queryGraphKnowledge(taskDescription, { project, limit: 10, includeProjectGraphNodes: false })
      .filter((result) => result.view.domainType === ContextDomainType.WORKFLOW)
      .slice(0, 3);
    const warnings = this.queryGraphKnowledge(`common mistakes pitfalls when ${taskDescription}`, {
      project,
      limit: 3,
      includeProjectGraphNodes: false,
    });
    const sections = this.formatCurationSections(
      taskDescription,
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
        loadProjectGraphFacts: (task, project, retrievalContext) =>
          this.loadProjectGraphFacts(task, project, retrievalContext),
        trackAssemblyRetrievals: (entries, task, sessionId) =>
          this.trackAssemblyRetrievals(entries, task, sessionId),
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

  /**
   * Render the curation-only slice of an assembled context: the
   * task-keyed search hits ("relevant graph knowledge" / "potential
   * pitfalls"). The DAG owns the surrounding `Operational Rules`,
   * `Repeated Patterns`, `Active Conflicts`, and `Project Graph
   * Relationships` sections — duplicating them in `curated.summary`
   * used to render the same titles two or three times in the same
   * MCP response.
   */
  private formatCurationSections(
    taskDescription: string,
    knowledge: GraphKnowledgeSearchResult[],
    workflows: GraphKnowledgeSearchResult[],
    warnings: GraphKnowledgeSearchResult[],
  ): string[] {
    return [generateGraphCurationSummary(taskDescription, knowledge, workflows, warnings)];
  }

  private findProjectSnapshot(project: string): ContextNode | null {
    return this.services.contextGraphStore.listNodes({
      project,
      substrateType: SubstrateType.SNAPSHOT,
      domainType: ContextDomainType.PROJECT_SNAPSHOT,
      limit: 1,
    })[0] ?? null;
  }

  /**
   * Pull project graph relationship facts for the assembled context. Loads
   * the project-scoped subset of project graph nodes + edges (capped at
   * `PROJECT_GRAPH_DEFAULT_QUERY_LIMIT`) and delegates the seed selection
   * + 1-hop expansion to `selectProjectGraphAssemblyFacts`.
   *
   * Returns `[]` when no project is in scope; the upstream summary
   * formatter then drops the section entirely instead of emitting an
   * empty header.
   */
  private loadProjectGraphFacts(
    taskDescription: string,
    project: string | undefined,
    retrievalContext: RetrievalContext | undefined,
  ): ProjectGraphContextFact[] {
    if (!project) return [];
    const nodes = this.services.contextGraphStore.listNodes({
      project,
      domainType: ContextDomainType.ARCHITECTURE,
      limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
    });
    if (nodes.length === 0) return [];
    const edges = this.services.contextGraphStore.listEdges({
      limit: PROJECT_GRAPH_DEFAULT_QUERY_LIMIT,
    });
    return selectProjectGraphAssemblyFacts({
      nodes,
      edges,
      taskDescription,
      context: retrievalContext,
    }).facts;
  }

  /**
   * Mint a feedback retrieval ticket for every node we surfaced in the
   * assembled context. The AI then closes the loop via
   * `mindstrate_memory_feedback_auto({ retrievalId, signal })`, which
   * lets `feedbackLoop.applyFeedbackToNode` increment
   * positive / negative feedback counts that downstream selectors use
   * for ranking. Without this step, the priority selector's feedback
   * fields stay flat regardless of how the AI actually used the
   * surfaced knowledge.
   */
  private trackAssemblyRetrievals(
    entries: Array<{ nodeId: string; origin: AssembledRetrieval['origin'] }>,
    taskDescription: string,
    sessionId: string | undefined,
  ): AssembledRetrieval[] {
    const result: AssembledRetrieval[] = [];
    for (const entry of entries) {
      try {
        const retrievalId = this.services.feedbackLoop.trackRetrieval(
          entry.nodeId,
          taskDescription,
          sessionId,
        );
        // Snapshot the node's cumulative feedback so the MCP layer can
        // render it inline with the retrieval ticket. Doing it server-
        // side avoids forcing every consumer to issue a round-trip per
        // ticket just to see "did anyone find this useful before?".
        const node = this.services.contextGraphStore.getNodeById(entry.nodeId);
        const feedback = node
          ? {
            positive: node.positiveFeedback ?? 0,
            negative: node.negativeFeedback ?? 0,
          }
          : undefined;
        result.push({ retrievalId, nodeId: entry.nodeId, origin: entry.origin, feedback });
      } catch {
        // A missing-node insert from a foreign-key violation just means
        // the surfaced node was already removed mid-assembly. Skip
        // silently rather than fail the whole assembly call.
      }
    }
    return result;
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
}

